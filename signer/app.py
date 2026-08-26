"""
Microserviço de assinatura PAdES (ICP-Brasil) — pyhanko + Flask.

Recebe o PDF já gerado pela aplicação Node (a assinatura *visível* já vem
desenhada no PDF) e o certificado A1 (.pfx/.p12) já descriptografado, e
devolve o PDF com a assinatura digital PAdES embutida (campo invisível).

Não persiste nenhum material criptográfico em disco: chave e senha existem
apenas em memória durante a requisição.
"""
import io
import logging

from flask import Flask, jsonify, request, send_file

from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import fields, signers
from pyhanko_certvalidator import ValidationContext

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MAX_PDF_BYTES = 20 * 1024 * 1024  # 20 MB
MAX_PFX_BYTES = 2 * 1024 * 1024   # 2 MB

FIELD_NAME = "AssinaturaMedico"


def _load_signer(pfx_bytes: bytes, password: str):
    return signers.SimpleSigner.load_pkcs12_data(
        pfx_bytes,
        other_certs=(),
        passphrase=password.encode("utf-8") if password else None,
    )


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
    """Extrai sujeito/emissor/validade do certificado (upload na aplicação)."""
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
    return jsonify(_cert_info(signer))


@app.post("/sign")
def sign():
    """Assina o PDF com PAdES (B-B; tenta B-LT embutindo revogações)."""
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

    try:
        try:
            # PAdES B-LT: embute status de revogação (OCSP/CRL) quando possível.
            # O contexto valida a cadeia e busca revogações nos endpoints do ICP-Brasil.
            signing_vc = ValidationContext(
                trust_roots=[signer.signing_cert],
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
            w = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
            out = signers.sign_pdf(w, meta, signer=signer, bytes_reserved=8192 * 4)
        except Exception as exc:
            # Rede/OCSP indisponível → assina PAdES B-B (baseline) sem revogações.
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
        logging.info(
            "PDF assinado: userId=%s bytes=%d", user_id, len(signed)
        )
        return send_file(io.BytesIO(signed), mimetype="application/pdf")
    except Exception as exc:
        logging.exception("Falha ao assinar o PDF")
        return jsonify({"error": f"Falha ao assinar o PDF: {exc}"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
