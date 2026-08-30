"""
Microserviço de assinatura PAdES (ICP-Brasil) — pyhanko + Flask.

Três modos de assinatura:
1. A1 local: recebe o PDF + o .pfx/.p12 já descriptografado (chave existe
   apenas em memória durante a requisição).
2. Bird ID em nuvem: recebe o PDF + o certificado (PEM) conectado no
   onboarding; a assinatura é obtida por push (/async-signature) aprovado
   pelo médico no app Bird ID — a chave privada nunca sai da nuvem.
3. Bird ID por sessão: recebe o PDF + o certificado (PEM) + o token da
   sessão signature_session; a assinatura é síncrona (/v0/oauth/signature),
   sem push por documento — o médico digitou o OTP ao abrir a sessão.

Conformidade ICP-Brasil:
- A cadeia do certificado é validada contra as ACs Raiz oficiais (arquivos
  PEM em icp-roots/ — v5 e v10) e o keyUsage nonRepudiation é exigido;
  certificado fora da ICP é recusado (fail-closed).
- O carimbo de tempo é obtido da ACT do Serpro (RFC 3161) → PAdES B-LT;
  se TSA/OCSP estiverem fora, cai para B-B e o nível efetivo volta no
  header X-Signature-Level.
- No fluxo em nuvem, o PDF final é reverificado criptograficamente contra
  o certificado informado antes de ser devolvido (protege contra o push
  assinar com chave divergente do certificado salvo).

Não persiste nenhum material criptográfico em disco.
"""
import asyncio
import base64
import hashlib
import io
import logging
import os
import time
from pathlib import Path

import requests
from asn1crypto import pem, x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.utils import Prehashed
from cryptography.hazmat.primitives.serialization import load_der_public_key
from flask import Flask, jsonify, request, send_file

from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.keys import load_certs_from_pemder
from pyhanko.sign import fields, signers
from pyhanko.sign.timestamps import HTTPTimeStamper
from pyhanko.sign.validation.pdf_embedded import EmbeddedPdfSignature
from pyhanko_certvalidator import ValidationContext, CertificateValidator
from pyhanko_certvalidator.registry import SimpleCertificateStore

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MAX_PDF_BYTES = 20 * 1024 * 1024  # 20 MB
MAX_PFX_BYTES = 2 * 1024 * 1024   # 2 MB

FIELD_NAME = "AssinaturaMedico"

# ACT (Autoridade Certificadora do Tempo) pública do Serpro — RFC 3161.
# Sobrescrevível via env TSA_URL (ex.: uma ACT privada contratada).
TSA_URL = os.environ.get("TSA_URL", "http://act.serpro.gov.br")

# Bird ID (VaultID) — nuvem pública. Homologação: https://apihom.birdid.com.br
# Fallback de ambiente: o padrão é a aplicação Node enviar a configuração
# salva no painel (Configurações → Integrações) em cada requisição.
BIRDID_BASE_URL = os.environ.get("BIRDID_BASE_URL", "https://api.birdid.com.br").rstrip("/")
BIRDID_CLIENT_ID = os.environ.get("BIRDID_CLIENT_ID", "")
BIRDID_CLIENT_SECRET = os.environ.get("BIRDID_CLIENT_SECRET", "")

# Assinatura via push: polling do resultado após a solicitação.
PUSH_POLL_INTERVAL = 2   # segundos
PUSH_POLL_TIMEOUT = 120  # segundos (tempo máximo aguardando o médico aprovar)

ICP_ROOTS_DIR = Path(__file__).parent / "icp-roots"


def _load_icp_roots():
    """Carrega as ACs Raiz ICP-Brasil empacotadas no container."""
    roots = []
    if ICP_ROOTS_DIR.is_dir():
        for path in sorted(ICP_ROOTS_DIR.glob("*.crt")):
            try:
                roots.extend(load_certs_from_pemder([path]))
            except Exception as exc:
                logging.warning("Falha ao carregar raiz ICP %s: %s", path.name, exc)
    return roots


ICP_ROOTS = _load_icp_roots()
if not ICP_ROOTS:
    logging.error(
        "Nenhuma AC Raiz ICP-Brasil carregada — nenhum certificado será aceito"
    )
else:
    logging.info("ACs Raiz ICP-Brasil carregadas: %d", len(ICP_ROOTS))


def _load_signer(pfx_bytes: bytes, password: str):
    """Abre o certificado A1 (.pfx/.p12) — chave só em memória."""
    return signers.SimpleSigner.load_pkcs12_data(
        pfx_bytes,
        other_certs=(),
        passphrase=password.encode("utf-8") if password else None,
    )


def _load_cert_from_pem(cert_pem: str):
    """Carrega um certificado X.509 a partir de um PEM (string)."""
    der = pem.unarmor(cert_pem.encode("utf-8"))[2]
    return x509.Certificate.load(der)


def _check_icp_cert_chain(cert, extra_certs):
    """
    Valida a cadeia de um certificado contra as ACs Raiz ICP-Brasil.
    Retorna (ok: bool, detalhe: str).
    """
    key_usage = cert.key_usage_value
    if key_usage is None or "non_repudiation" not in (key_usage.native or set()):
        return False, "sem keyUsage nonRepudiation (não é um e-CPF ICP-Brasil)"
    if cert.subject == cert.issuer:
        return False, "certificado autoassinado (não pertence à ICP-Brasil)"

    def validate(allow_fetching: bool) -> None:
        context = ValidationContext(
            trust_roots=ICP_ROOTS,
            other_certs=list(extra_certs),
            allow_fetching=allow_fetching,
        )
        validator = CertificateValidator(
            cert,
            intermediate_certs=list(extra_certs),
            validation_context=context,
        )
        asyncio.run(validator.async_validate_usage({"non_repudiation"}))

    # Tenta primeiro com busca de certificados intermediários (AIA).
    try:
        validate(allow_fetching=True)
        return True, ""
    except Exception as exc:
        logging.warning("Validação com AIA falhou: %s", exc)
    # Segunda tentativa só com a cadeia local (sem rede).
    try:
        validate(allow_fetching=False)
        return True, ""
    except Exception as exc:
        logging.warning("Validação local falhou: %s", exc)
    return False, "cadeia não confiável (não pertence à ICP-Brasil)"


def _fetch_aia_chain(cert, max_depth=6):
    """
    Baixa os certificados intermediários da cadeia via AIA (caIssuers),
    melhor esforço: certificados não encontrados não bloqueiam a assinatura
    (o pyhanko completa a cadeia via DSS quando embed_validation_info=True).
    """
    chain = []
    seen = {cert.dump()}
    current = cert
    for _ in range(max_depth):
        try:
            urls = current.ca_issuers_value.native
        except (AttributeError, ValueError):
            urls = None
        if not urls:
            break
        found = None
        for url in urls:
            if not isinstance(url, str) or not url.startswith("http"):
                continue
            try:
                resp = requests.get(url, timeout=10)
                resp.raise_for_status()
                issuer = x509.Certificate.load(pem.unarmor(resp.content)[2])
            except Exception as exc:
                logging.info("Falha ao baixar AIA %s: %s", url, exc)
                continue
            if issuer.dump() in seen:
                continue
            if issuer.subject == current.issuer:
                found = issuer
                break
        if found is None:
            break
        seen.add(found.dump())
        chain.append(found)
        current = found
    return chain


def _cert_info(cert):
    """Dados do certificado para exibição/validação (human_friendly)."""
    return {
        "subject": cert.subject.human_friendly,
        "issuer": cert.issuer.human_friendly,
        "serialNumber": format(cert.serial_number, "x").upper(),
        "validFrom": cert.not_valid_before.isoformat(),
        "validTo": cert.not_valid_after.isoformat(),
    }


# ---------------------------------------------------------------------------
# Bird ID em nuvem (assinatura por push)
# ---------------------------------------------------------------------------

class BirdIdPushError(Exception):
    """Assinatura push do Bird ID recusada, expirada ou com erro."""


def _decode_signature(raw: str) -> bytes:
    """RAW vem em base64; tolera também PEM (caso o formato mude)."""
    raw = raw.strip()
    if raw.startswith("-----BEGIN"):
        return pem.unarmor(raw.encode("utf-8"))[2]
    return base64.b64decode(raw)


def _birdid_push_sign(cpf, message, digest_hex, base_url=None, client_id=None, client_secret=None):
    """
    Solicita a assinatura do hash via push e aguarda o médico aprovar no
    app Bird ID (polling do resultado com o token da resposta 201). A
    configuração vem da requisição (painel Integrações); env como fallback.
    """
    base_url = (base_url or BIRDID_BASE_URL).rstrip("/")
    client_id = client_id or BIRDID_CLIENT_ID
    client_secret = client_secret or BIRDID_CLIENT_SECRET
    if not client_id or not client_secret:
        raise BirdIdPushError("Bird ID não configurado (Configurações → Integrações)")

    payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "username": cpf,
        "message": (message or "Aprovar assinatura")[:200],
        "hashes": [digest_hex],
        "signature_format": "RAW",  # PKCS#1 v1.5 direto sobre o hash
        "lifetime": 300,
    }
    try:
        resp = requests.post(
            f"{base_url}/async-signature", json=payload, timeout=15
        )
    except requests.RequestException as exc:
        raise BirdIdPushError(f"Bird ID indisponível: {exc}") from exc
    if resp.status_code not in (200, 201):
        logging.warning("Bird ID recusou a solicitação: HTTP %s %s", resp.status_code, resp.text[:200])
        raise BirdIdPushError(f"Bird ID recusou a solicitação (HTTP {resp.status_code})")
    try:
        token = resp.json().get("token")
    except ValueError:
        token = None
    if not token:
        raise BirdIdPushError("Bird ID não retornou o token da assinatura")

    deadline = time.monotonic() + PUSH_POLL_TIMEOUT
    while time.monotonic() < deadline:
        time.sleep(PUSH_POLL_INTERVAL)
        try:
            poll = requests.get(
                f"{base_url}/async-signature",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
        except requests.RequestException:
            continue
        if poll.status_code == 200:
            try:
                signatures = poll.json().get("rawSignatures") or []
            except ValueError:
                signatures = []
            if signatures:
                return _decode_signature(signatures[0])
    raise BirdIdPushError("aprovação não recebida no app Bird ID (tempo esgotado)")


class BirdIdPushSigner(signers.Signer):
    """
    Signer cuja operação criptográfica acontece na nuvem Bird ID: o digest
    dos atributos assinados é enviado via push e o médico aprova no app.
    O CMS/PAdES completo é montado pelo próprio pyhanko.
    """

    def __init__(self, signing_cert, cert_registry, cpf: str, message: str,
                 base_url=None, client_id=None, client_secret=None):
        super().__init__(
            prefer_pss=False,
            signing_cert=signing_cert,
            cert_registry=cert_registry,
        )
        self._cpf = cpf
        self._message = message
        self._base_url = base_url
        self._client_id = client_id
        self._client_secret = client_secret
        self.push_attempted = False

    async def async_sign_raw(self, data, digest_algorithm, dry_run=False):
        if dry_run:
            return bytes(256)  # placeholder RSA-2048 (estimativa de tamanho)
        digest_hex = hashlib.sha256(data).hexdigest()
        self.push_attempted = True
        return _birdid_push_sign(
            self._cpf, self._message, digest_hex,
            self._base_url, self._client_id, self._client_secret,
        )


# ---------------------------------------------------------------------------
# Bird ID em nuvem (assinatura síncrona por sessão signature_session)
# ---------------------------------------------------------------------------

class BirdIdSessionError(Exception):
    """Token de sessão Bird ID inválido/expirado ou erro na assinatura síncrona."""

    def __init__(self, message: str, invalid_token: bool = False):
        super().__init__(message)
        self.invalid_token = invalid_token


def _birdid_session_sign(alias: str, session_token: str, digest_hex: str,
                         base_url=None) -> bytes:
    """
    Assina o hash via POST /v0/oauth/signature usando o token da sessão
    signature_session (resposta imediata, sem push). Formato RAW: PKCS#1
    v1.5 direto sobre o hash SHA-256 (OID 2.16.840.1.101.3.4.2.1). A base
    da API vem da requisição (painel Integrações); env como fallback.
    """
    base_url = (base_url or BIRDID_BASE_URL).rstrip("/")
    payload = {
        "certificate_alias": alias,
        "hashes": [
            {
                "id": "1",
                "alias": alias,
                "hash": digest_hex,
                "hash_algorithm": "2.16.840.1.101.3.4.2.1",
                "signature_format": "RAW",
            }
        ],
    }
    try:
        resp = requests.post(
            f"{base_url}/v0/oauth/signature",
            json=payload,
            headers={"Authorization": f"Bearer {session_token}"},
            timeout=20,
        )
    except requests.RequestException as exc:
        raise BirdIdSessionError(f"Bird ID indisponível: {exc}") from exc
    if resp.status_code in (401, 403):
        raise BirdIdSessionError(
            "sessão de assinatura inválida ou expirada (abra uma nova sessão)",
            invalid_token=True,
        )
    if resp.status_code not in (200, 201):
        logging.warning("Bird ID recusou a assinatura síncrona: HTTP %s %s", resp.status_code, resp.text[:200])
        raise BirdIdSessionError(
            f"Bird ID recusou a assinatura síncrona (HTTP {resp.status_code})"
        )
    try:
        signatures = resp.json().get("signatures") or []
    except ValueError:
        signatures = []
    if not signatures:
        raise BirdIdSessionError("Bird ID não retornou a assinatura síncrona")
    raw = signatures[0].get("raw_signature") or signatures[0].get("rawSignature")
    if not raw:
        raise BirdIdSessionError("Bird ID retornou assinatura síncrona vazia")
    return _decode_signature(raw)


class BirdIdSessionSigner(signers.Signer):
    """
    Signer cuja operação criptográfica acontece na nuvem Bird ID via token
    de sessão signature_session — resposta imediata, sem push por documento.
    O CMS/PAdES completo é montado pelo próprio pyhanko.
    """

    def __init__(self, signing_cert, cert_registry, alias: str, session_token: str,
                 base_url=None):
        super().__init__(
            prefer_pss=False,
            signing_cert=signing_cert,
            cert_registry=cert_registry,
        )
        self._alias = alias
        self._session_token = session_token
        self._base_url = base_url

    async def async_sign_raw(self, data, digest_algorithm, dry_run=False):
        if dry_run:
            return bytes(256)  # placeholder RSA-2048 (estimativa de tamanho)
        digest_hex = hashlib.sha256(data).hexdigest()
        return _birdid_session_sign(self._alias, self._session_token, digest_hex, self._base_url)


def _verify_signature_matches_cert(signed_pdf: bytes, cert):
    """
    Confere que a assinatura embutida no PDF foi produzida com a chave do
    certificado validado (o push assinou com outra chave → erro).
    """
    reader = PdfFileReader(io.BytesIO(signed_pdf))
    sig_fields = list(fields.enumerate_sig_fields(reader))
    if not sig_fields:
        raise ValueError("PDF assinado não contém campo de assinatura")
    fq_name, _field_value, field_ref = sig_fields[0]
    emb = EmbeddedPdfSignature(reader, field_ref, fq_name)
    if emb.signer_cert.dump() != cert.dump():
        raise ValueError("certificado embutido difere do certificado validado")
    signature_value = emb.signer_info["signature"].native
    # Os atributos assinados vêm com tag de contexto (0xA0); a assinatura
    # cobre a codificação com a tag universal SET OF (0x31) — re-etiquetar
    # antes de hashear (mesmo tratamento do verificador do pyhanko).
    signed_attrs_der = emb.signer_info["signed_attrs"].untag().dump()
    digest = hashlib.sha256(signed_attrs_der).digest()
    try:
        pub = load_der_public_key(cert.public_key.dump())
        # O Bird ID (formato RAW) aplica o RSA diretamente sobre o hash
        # enviado — equivalente a PKCS#1 v1.5 com digest pré-calculado.
        pub.verify(
            signature_value, digest, padding.PKCS1v15(), Prehashed(hashes.SHA256())
        )
    except Exception as exc:
        raise ValueError(
            "assinatura não confere com a chave do certificado"
        ) from exc


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/inspect")
def inspect():
    """Extrai sujeito/emissor/validade e valida a cadeia ICP-Brasil (A1)."""
    pfx = request.files.get("pfx")
    password = request.form.get("password") or ""
    if pfx is None:
        return jsonify({"error": "Arquivo .pfx ausente"}), 400
    pfx_bytes = pfx.read()
    if len(pfx_bytes) > MAX_PFX_BYTES:
        return jsonify({"error": "Arquivo .pfx muito grande"}), 400
    try:
        signer = _load_signer(pfx_bytes, password)
    except Exception as exc:
        logging.warning("Falha ao abrir o pfx: %s", exc)
        return jsonify(
            {"error": "Não foi possível abrir o certificado — verifique a senha"}
        ), 400
    info = _cert_info(signer.signing_cert)
    ok, detail = _check_icp_cert_chain(signer.signing_cert, signer.cert_registry)
    info["icpBrasil"] = ok
    info["chainMessage"] = detail
    return jsonify(info)


@app.post("/inspect-pem")
def inspect_pem():
    """Valida o certificado em nuvem (PEM) recebido no onboarding Bird ID."""
    data = request.get_json(silent=True) or {}
    cert_pem = (data.get("certPem") or "").strip()
    if not cert_pem:
        return jsonify({"error": "Certificado (PEM) ausente"}), 400
    try:
        cert = _load_cert_from_pem(cert_pem)
    except Exception as exc:
        logging.warning("Falha ao ler o certificado PEM: %s", exc)
        return jsonify({"error": "Não foi possível ler o certificado"}), 400
    info = _cert_info(cert)
    ok, detail = _check_icp_cert_chain(cert, [])
    info["icpBrasil"] = ok
    info["chainMessage"] = detail
    return jsonify(info)


@app.post("/sign")
def sign():
    """
    Assina o PDF com PAdES B-LT (carimbo de tempo ICP + revogações embutidas)
    e cai para B-B se TSA/OCSP estiverem indisponíveis. Certificado fora da
    ICP-Brasil é recusado. Modo A1 (.pfx/.p12).
    """
    pdf_file = request.files.get("pdf")
    pfx = request.files.get("pfx")
    password = request.form.get("password") or ""
    doctor_name = (request.form.get("doctorName") or "Medico").strip()[:120]
    reason = (request.form.get("reason") or "Assinatura de documento medico").strip()[:200]
    user_id = (request.form.get("userId") or "").strip()[:80]

    if pdf_file is None or pfx is None:
        return jsonify({"error": "PDF ou certificado ausente"}), 400

    pdf_bytes = pdf_file.read()
    if len(pdf_bytes) > MAX_PDF_BYTES:
        return jsonify({"error": "PDF muito grande"}), 400
    pfx_bytes = pfx.read()
    if len(pfx_bytes) > MAX_PFX_BYTES:
        return jsonify({"error": "Arquivo .pfx muito grande"}), 400

    try:
        signer = _load_signer(pfx_bytes, password)
    except Exception as exc:
        logging.warning("Falha ao abrir o pfx: %s", exc)
        return jsonify(
            {"error": "Não foi possível abrir o certificado — verifique a senha"}
        ), 400

    # Validação ICP-Brasil obrigatória (fail-closed).
    icp_ok, icp_detail = _check_icp_cert_chain(signer.signing_cert, signer.cert_registry)
    if not icp_ok:
        logging.warning("Certificado recusado (ICP-Brasil): %s", icp_detail)
        return jsonify(
            {"error": f"Certificado não é ICP-Brasil válido: {icp_detail}"}
        ), 400

    level = "B-B"
    try:
        # PAdES B-LT: carimbo de tempo certificado (ACT Serpro) + revogações
        # (OCSP/CRL) embutidas a partir da validação da cadeia ICP-Brasil.
        signing_vc = ValidationContext(
            trust_roots=ICP_ROOTS,
            other_certs=list(signer.cert_registry),
            allow_fetching=True,
        )
        meta = signers.PdfSignatureMetadata(
            field_name=FIELD_NAME,
            md_algorithm="sha256",
            name=doctor_name,
            reason=reason,
            subfilter=fields.SigSeedSubFilter.PADES,
            embed_validation_info=True,
            validation_context=signing_vc,
        )
        timestamper = HTTPTimeStamper(
            TSA_URL, https=TSA_URL.startswith("https"), timeout=10
        )
        w = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
        out = signers.sign_pdf(
            w, meta, signer=signer, timestamper=timestamper, bytes_reserved=8192 * 12
        )
        level = "B-LT"
    except Exception as exc:
        # TSA/OCSP/rede indisponíveis → assina PAdES B-B (baseline), sem
        # revogações nem carimbo; o nível efetivo volta no header.
        logging.warning("B-LT indisponível, assinando PAdES B-B: %s", exc)
        meta = signers.PdfSignatureMetadata(
            field_name=FIELD_NAME,
            md_algorithm="sha256",
            name=doctor_name,
            reason=reason,
            subfilter=fields.SigSeedSubFilter.PADES,
            embed_validation_info=False,
        )
        w = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
        out = signers.sign_pdf(w, meta, signer=signer, bytes_reserved=8192 * 4)

    signed = out.getvalue()
    logging.info("PDF assinado: userId=%s level=%s bytes=%d", user_id, level, len(signed))
    response = send_file(io.BytesIO(signed), mimetype="application/pdf")
    response.headers["X-Signature-Level"] = level
    return response


@app.post("/sign-cloud")
def sign_cloud():
    """
    Assina o PDF com o certificado em nuvem Bird ID: o digest dos atributos
    é assinado via push (o médico aprova no app) e o CMS/PAdES é montado
    pelo pyhanko. PAdES B-LT com carimbo ACT Serpro; fallback B-B.
    """
    pdf_file = request.files.get("pdf")
    cert_pem = (request.form.get("certPem") or "").strip()
    cpf = (request.form.get("cpf") or "").strip()
    message = (request.form.get("message") or "Aprovar assinatura").strip()[:200]
    doctor_name = (request.form.get("doctorName") or "Medico").strip()[:120]
    reason = (request.form.get("reason") or "Assinatura de documento medico").strip()[:200]
    user_id = (request.form.get("userId") or "").strip()[:80]
    # Configuração vinda do painel (Integrações); env do signer como fallback.
    birdid_base_url = (request.form.get("birdIdBaseUrl") or "").strip()
    birdid_client_id = (request.form.get("birdIdClientId") or "").strip()
    birdid_client_secret = (request.form.get("birdIdClientSecret") or "").strip()

    if pdf_file is None:
        return jsonify({"error": "PDF ausente"}), 400
    if not cert_pem:
        return jsonify({"error": "Certificado ausente"}), 400
    if not cpf:
        return jsonify({"error": "CPF do titular ausente"}), 400

    pdf_bytes = pdf_file.read()
    if len(pdf_bytes) > MAX_PDF_BYTES:
        return jsonify({"error": "PDF muito grande"}), 400

    try:
        cert = _load_cert_from_pem(cert_pem)
    except Exception as exc:
        logging.warning("Falha ao ler o certificado PEM: %s", exc)
        return jsonify({"error": "Não foi possível ler o certificado do médico"}), 400

    # Cadeia ICP-Brasil obrigatória (fail-closed); intermediários via AIA
    # para embutir no CMS (o restante da cadeia entra no DSS pelo pyhanko).
    intermediates = _fetch_aia_chain(cert)
    icp_ok, icp_detail = _check_icp_cert_chain(cert, intermediates)
    if not icp_ok:
        logging.warning("Certificado em nuvem recusado (ICP-Brasil): %s", icp_detail)
        return jsonify(
            {"error": f"Certificado não é ICP-Brasil válido: {icp_detail}"}
        ), 400

    cert_store = SimpleCertificateStore()
    cert_store.register_multiple([cert] + intermediates)
    push_signer = BirdIdPushSigner(
        cert, cert_store, cpf, message,
        birdid_base_url or None,
        birdid_client_id or None,
        birdid_client_secret or None,
    )

    level = "B-B"
    try:
        # PAdES B-LT: carimbo de tempo certificado (ACT Serpro) + revogações.
        # A validação pré-assinatura do pyhanko coleta revogações e um
        # carimbo "dummy" (cacheado) ANTES do push — TSA/OCSP fora falham
        # aqui, antes de pedir aprovação ao médico.
        signing_vc = ValidationContext(
            trust_roots=ICP_ROOTS,
            other_certs=intermediates,
            allow_fetching=True,
        )
        meta = signers.PdfSignatureMetadata(
            field_name=FIELD_NAME,
            md_algorithm="sha256",
            name=doctor_name,
            reason=reason,
            subfilter=fields.SigSeedSubFilter.PADES,
            embed_validation_info=True,
            validation_context=signing_vc,
        )
        timestamper = HTTPTimeStamper(
            TSA_URL, https=TSA_URL.startswith("https"), timeout=10
        )
        w = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
        out = signers.sign_pdf(
            w, meta, signer=push_signer, timestamper=timestamper, bytes_reserved=8192 * 12
        )
        level = "B-LT"
    except BirdIdPushError as exc:
        # Sem aprovação/erro do Bird ID → o documento segue sem assinatura
        # (o Node aplica o fallback de sempre).
        logging.info("Assinatura em nuvem não aprovada: %s", exc)
        return jsonify({"error": str(exc)}), 409
    except Exception as exc:
        logging.warning("B-LT indisponível no fluxo em nuvem: %s", exc)
        if push_signer.push_attempted:
            # A aprovação já foi dada e a finalização falhou: não pedir nova
            # aprovação ao médico — devolve erro e o documento segue sem
            # assinatura digital.
            logging.error("Falha após aprovação do push — não será re-tentado")
            return jsonify(
                {"error": "Falha ao finalizar a assinatura após a aprovação"}
            ), 502
        try:
            meta = signers.PdfSignatureMetadata(
                field_name=FIELD_NAME,
                md_algorithm="sha256",
                name=doctor_name,
                reason=reason,
                subfilter=fields.SigSeedSubFilter.PADES,
                embed_validation_info=False,
            )
            w = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
            out = signers.sign_pdf(w, meta, signer=push_signer, bytes_reserved=8192 * 4)
        except BirdIdPushError as exc2:
            logging.info("Assinatura em nuvem não aprovada (B-B): %s", exc2)
            return jsonify({"error": str(exc2)}), 409
        except Exception as exc2:
            logging.warning("B-B em nuvem falhou: %s", exc2)
            return jsonify({"error": "Falha na assinatura em nuvem"}), 502

    # Verificação pós-assinatura: garante que o push assinou com a chave do
    # certificado validado antes de devolver o PDF.
    try:
        _verify_signature_matches_cert(out.getvalue(), cert)
    except Exception as exc:
        logging.error("Verificação pós-assinatura falhou: %s", exc)
        return jsonify(
            {"error": "Assinatura recebida não confere com o certificado do médico"}
        ), 502

    signed = out.getvalue()
    logging.info("PDF assinado em nuvem: userId=%s level=%s bytes=%d", user_id, level, len(signed))
    response = send_file(io.BytesIO(signed), mimetype="application/pdf")
    response.headers["X-Signature-Level"] = level
    return response


@app.post("/sign-session")
def sign_session():
    """
    Assina o PDF com o certificado em nuvem Bird ID usando a sessão
    signature_session do médico (POST /v0/oauth/signature): resposta
    imediata, sem push por documento. PAdES B-LT com carimbo ACT Serpro;
    fallback B-B. Token de sessão inválido/expirado → HTTP 401.
    """
    pdf_file = request.files.get("pdf")
    cert_pem = (request.form.get("certPem") or "").strip()
    alias = (request.form.get("alias") or "").strip()
    session_token = (request.form.get("sessionToken") or "").strip()
    doctor_name = (request.form.get("doctorName") or "Medico").strip()[:120]
    reason = (request.form.get("reason") or "Assinatura de documento medico").strip()[:200]
    user_id = (request.form.get("userId") or "").strip()[:80]
    # Base da API vinda do painel (Integrações); env do signer como fallback.
    birdid_base_url = (request.form.get("birdIdBaseUrl") or "").strip()

    if pdf_file is None:
        return jsonify({"error": "PDF ausente"}), 400
    if not cert_pem:
        return jsonify({"error": "Certificado ausente"}), 400
    if not alias:
        return jsonify({"error": "Alias do certificado ausente"}), 400
    if not session_token:
        return jsonify({"error": "Token de sessão ausente"}), 400

    pdf_bytes = pdf_file.read()
    if len(pdf_bytes) > MAX_PDF_BYTES:
        return jsonify({"error": "PDF muito grande"}), 400

    try:
        cert = _load_cert_from_pem(cert_pem)
    except Exception as exc:
        logging.warning("Falha ao ler o certificado PEM: %s", exc)
        return jsonify({"error": "Não foi possível ler o certificado do médico"}), 400

    # Cadeia ICP-Brasil obrigatória (fail-closed); intermediários via AIA.
    intermediates = _fetch_aia_chain(cert)
    icp_ok, icp_detail = _check_icp_cert_chain(cert, intermediates)
    if not icp_ok:
        logging.warning("Certificado em nuvem recusado (ICP-Brasil): %s", icp_detail)
        return jsonify(
            {"error": f"Certificado não é ICP-Brasil válido: {icp_detail}"}
        ), 400

    cert_store = SimpleCertificateStore()
    cert_store.register_multiple([cert] + intermediates)
    session_signer = BirdIdSessionSigner(
        cert, cert_store, alias, session_token, birdid_base_url or None
    )

    level = "B-B"
    try:
        # PAdES B-LT: carimbo de tempo certificado (ACT Serpro) + revogações.
        signing_vc = ValidationContext(
            trust_roots=ICP_ROOTS,
            other_certs=intermediates,
            allow_fetching=True,
        )
        meta = signers.PdfSignatureMetadata(
            field_name=FIELD_NAME,
            md_algorithm="sha256",
            name=doctor_name,
            reason=reason,
            subfilter=fields.SigSeedSubFilter.PADES,
            embed_validation_info=True,
            validation_context=signing_vc,
        )
        timestamper = HTTPTimeStamper(
            TSA_URL, https=TSA_URL.startswith("https"), timeout=10
        )
        w = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
        out = signers.sign_pdf(
            w, meta, signer=session_signer, timestamper=timestamper, bytes_reserved=8192 * 12
        )
        level = "B-LT"
    except BirdIdSessionError as exc:
        # Token inválido/expirado → 401 para o Node marcar a sessão EXPIRED;
        # erro geral do Bird ID → 502 e o Node tenta o fluxo de push.
        if exc.invalid_token:
            logging.info("Sessão Bird ID inválida: %s", exc)
            return jsonify({"error": str(exc)}), 401
        logging.warning("Assinatura síncrona falhou: %s", exc)
        return jsonify({"error": str(exc)}), 502
    except Exception as exc:
        logging.warning("B-LT indisponível no fluxo por sessão: %s", exc)
        try:
            meta = signers.PdfSignatureMetadata(
                field_name=FIELD_NAME,
                md_algorithm="sha256",
                name=doctor_name,
                reason=reason,
                subfilter=fields.SigSeedSubFilter.PADES,
                embed_validation_info=False,
            )
            w = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
            out = signers.sign_pdf(w, meta, signer=session_signer, bytes_reserved=8192 * 4)
        except BirdIdSessionError as exc2:
            if exc2.invalid_token:
                logging.info("Sessão Bird ID inválida (B-B): %s", exc2)
                return jsonify({"error": str(exc2)}), 401
            logging.warning("Assinatura síncrona falhou (B-B): %s", exc2)
            return jsonify({"error": str(exc2)}), 502
        except Exception as exc2:
            logging.warning("B-B por sessão falhou: %s", exc2)
            return jsonify({"error": "Falha na assinatura por sessão"}), 502

    # Verificação pós-assinatura: garante que a nuvem assinou com a chave do
    # certificado validado antes de devolver o PDF.
    try:
        _verify_signature_matches_cert(out.getvalue(), cert)
    except Exception as exc:
        logging.error("Verificação pós-assinatura falhou: %s", exc)
        return jsonify(
            {"error": "Assinatura recebida não confere com o certificado do médico"}
        ), 502

    signed = out.getvalue()
    logging.info("PDF assinado por sessão: userId=%s level=%s bytes=%d", user_id, level, len(signed))
    response = send_file(io.BytesIO(signed), mimetype="application/pdf")
    response.headers["X-Signature-Level"] = level
    return response


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
