FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# ACs Raiz ICP-Brasil (v5 e v10) baixadas do repositório oficial do ITI na
# build (bytes exatos da fonte oficial) e verificadas antes da imagem fechar.
RUN mkdir -p icp-roots \
 && python -c "import urllib.request; urllib.request.urlretrieve('http://acraiz.icpbrasil.gov.br/ICP-Brasilv5.crt', 'icp-roots/icp-brasil-v5.crt'); urllib.request.urlretrieve('http://acraiz.icpbrasil.gov.br/ICP-Brasilv10.crt', 'icp-roots/icp-brasil-v10.crt')" \
 && python -c "from pyhanko.keys import load_certs_from_pemder; certs = list(load_certs_from_pemder(['icp-roots/icp-brasil-v5.crt', 'icp-roots/icp-brasil-v10.crt'])); assert len(certs) == 2, f'raizes invalidas: {len(certs)}'; print('ICP roots OK:', [c.subject.human_friendly for c in certs])"

EXPOSE 8000
CMD ["python", "app.py"]
