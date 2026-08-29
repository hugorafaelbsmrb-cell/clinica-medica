"""
Microserviço de assinatura PAdES (ICP-Brasil) — pyhanko + Flask.

Recebe o PDF já gerado pela aplicação Node (a assinatura *visível* já vem
desenhada no PDF) e o certificado A1 (.pfx/.p12) já descriptografado, e
devolve o PDF com a assinatura digital PAdES embutida (campo invisível).

Conformidade ICP-Brasil:
- A cadeia do certificado é validada contra as ACs Raiz oficiais (arquivos
  PEM em icp-roots/ — v5 e v10) e o keyUsage nonRepudiation é exigido;
  certificado fora da ICP é recusado (fail-closed).
- O carimbo de tempo é obtido da ACT do Serpro (RFC 3161), o que dá
  validade de longa duração; se TSA/OCSP estiverem fora, cai para B-B e
  o nível efetivo volta no header X-Signature-Level.

Não persiste nenhum material criptográfico em disco: chave e senha existem
apenas em memória durante a requisição.
"""
import asyncio
import io
import logging
import os
from pathlib import Path

from flask import Flask, jsonify, request, send_file

from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.keys import load_certs_from_pemder
from pyhanko.sign import fields, signers
from pyhanko.sign.timestamps import HTTPTimeStamper
from pyhanko_certvalidator import ValidationContext, CertificateValidator

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MAX_PDF_BYTES = 20 * 1024 * 1024  # 20 MB
MAX_PFX_BYTES = 2 * 1024 * 1024   # 2 MB

FIELD_NAME = "AssinaturaMedico"

# ACT (Autoridade Certificadora do Tempo) pública do Serpro — RFC 3161.
# Sobrescrevível via env TSA_URL (ex.: uma ACT privada contratada).
TSA_URL = os.environ.get("TSA_URL", "http://act.serpro.gov.br")

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
    return signers.SimpleSigner.load_pkcs12_data(
        pfx_bytes,
        other_certs=(),
        passphrase=password.encode("utf-8") if password else None,
    )


def _validation_context(signer, allow_fetching: bool) -> ValidationContext:
    return ValidationContext(
        trust_roots=ICP_ROOTS,
        other_certs=list(signer.cert_registry),
        allow_fetching=allow_fetching,
    )


def _check_icp_chain(signer, allow_fetching: bool):
    """
    Valida a cadeia do certificado contra as ACs Raiz ICP-Brasil.
    Retorna (ok: bool, detalhe: str).
    """
    cert = signer.signing_cert
    key_usage = cert.key_usage_value
    if key_usage is None or "non_repudiation" not in (key_usage.native or set()):
        return False, "sem keyUsage nonRepudiation (não é um e-CPF ICP-Brasil)"
    if cert.subject == cert.issuer:
        return False, "certificado autoassinado (não pertence à ICP-Brasil)"

    def validate(context) -> None:
        validator = CertificateValidator(
            cert,
            intermediate_certs=list(signer.cert_registry),
            validation_context=context,
        )
        asyncio.run(validator.async_validate_usage({"non_repudiation"}))

    # Tenta primeiro com busca de certificados intermediários (AIA).
    try:
        validate(_validation_context(signer, allow_fetching=True))
        return True, ""
    except Exception as exc:
        logging.warning("Validação com AIA falhou: %s", exc)
    # Segunda tentativa só com a cadeia local (sem rede).
    if allow_fetching:
        try:
            validate(_validation_context(signer, allow_fetching=False))
            return True, ""
        except Exception as exc:
            logging.warning("Validação local falhou: %s", exc)
    return False, "cadeia não confiável (não pertence à ICP-Brasil)"


def _cert_info(signer):
    """Dados do certificado para exibição/validação (human_friendly)."""
    cert = signer.signing_cert
    return {
        "subject": cert.subject.human_friendly,
        "issuer": cert.issuer.human_friendly,
        "serialNumber": format(cert.serial_number, "x").upper(),
        "validFrom": cert.not_valid_before.isoformat(),
        "validTo": cert.not_valid_after.isoformat(),
    }


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/inspect")
def inspect():
    """Extrai sujeito/emissor/validade e valida a cadeia ICP-Brasil."""
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
    info = _cert_info(signer)
    ok, detail = _check_icp_chain(signer, allow_fetching=True)
    info["icpBrasil"] = ok
    info["chainMessage"] = detail
    return jsonify(info)


@app.post("/sign")
def sign():
    """
    Assina o PDF com PAdES B-LT (carimbo de tempo ICP + revogações embutidas)
    e cai para B-B se TSA/OCSP estiverem indisponíveis. Certificado fora da
    ICP-Brasil é recusado.
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
    icp_ok, icp_detail = _check_icp_chain(signer, allow_fetching=True)
    if not icp_ok:
        logging.warning("Certificado recusado (ICP-Brasil): %s", icp_detail)
        return jsonify(
            {"error": f"Certificado não é ICP-Brasil válido: {icp_detail}"}
        ), 400

    level = "B-B"
    try:
        # PAdES B-LT: carimbo de tempo certificado (ACT Serpro) + revogações
        # (OCSP/CRL) embutidas a partir da validação da cadeia ICP-Brasil.
        signing_vc = _validation_context(signer, allow_fetching=True)
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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
