cd /opt/clinica-medica
docker compose logs --tail=100 app 2>&1 | grep -iE "error|erro|failed|exception" | tail -30
echo "--- fim grep erros ---"
docker compose logs --tail=30 app 2>&1 | tail -30
