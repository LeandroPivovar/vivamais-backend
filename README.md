# Acesso Saúde — Backend

NestJS + TypeORM + MySQL. Substitui os dados mockados do front (`Acesso-Saude-APP-main`) por API real.

## Setup local

```bash
npm install
cp .env.example .env   # ajustar credenciais do MySQL local
mysql -u root -e "CREATE DATABASE acesso_saude"
npm run migration:run
npm run seed
npm run start:dev
```

Backend sobe em `http://localhost:3011/api`.

Login seedado (admin): `joao.silva@email.com` / `senha123`.

## Deploy (VPS, mesmo padrão do nucleo-crm)

```bash
git pull origin main
npm install --production
npm run build
npm run migration:run
pm2 restart acesso-saude-backend --update-env && pm2 save
```

## Placeholder que continua existindo

As rotas `POST /api/sso/:benefit` (Telemedicina, Clube de Descontos, Funerária, Veterinário) geram um token assinado e
registram o acesso real em `activities`, mas o `redirectUrl` aponta pra um domínio placeholder — não há integração
real com parceiro. Precisa de credenciais/API de cada parceiro pra virar redirect de verdade.
