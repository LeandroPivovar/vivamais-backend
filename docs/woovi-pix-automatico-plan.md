# Plano de integração — Woovi/OpenPix Pix Automático

Objetivo: débito automático mensal de verdade (cliente autoriza 1x no banco → Woovi
debita sozinha todo mês), substituindo/coexistindo com a assinatura PIX da Veenca
(que é QR novo por ciclo, não débito automático).

## Modelo Woovi (confirmado na referência developers.woovi.com/api)

- **Auth**: header `Authorization: <AppID>`. Base prod `https://api.woovi.com`,
  sandbox `https://api.woovi-sandbox.com`.
- **Fluxo Pix Automático**:
  `subscription` (recorrência autorizada) → gera `installments` (parcelas) →
  cada parcela vira uma `CobR` debitada automaticamente.
- **Endpoints**:
  - `POST /api/v1/subscriptions` — cria a assinatura (retorna `globalID`; `value` em centavos; `customer` idempotente por taxID)
  - `GET /api/v1/subscriptions` · `GET /api/v1/subscriptions/{id}`
  - `GET /api/v1/subscriptions/{id}/installments` · `GET /api/v1/installments/{id}`
  - `PUT /api/v1/subscriptions/{id}/cancel` · `PUT /api/v1/subscriptions/{id}/value`
  - `POST /api/v1/installments/{id}/cobr` · `/cobr/retry` (gerar/retentar cobrança da parcela)
- **Webhooks**: `PIX_AUTOMATIC_APPROVED` (autorização aprovada),
  `PIX_AUTOMATIC_COBR_COMPLETED` (parcela paga). Assinados por Woovi (validar via public key / `x-webhook-signature`).

## Contrato confirmado (spec oficial `developers.woovi.com/swaggers/woovi.json`)

**Criar** — `POST /api/v1/subscriptions` (obrigatórios: `customer`, `value`, `correlationID`, `type`):
```json
{
  "type": "PIX_RECURRING",            // marca Pix Automático (vs "RECURRENT" = recorrência comum)
  "value": 7990,                       // CENTAVOS
  "correlationID": "vm-<userId>-<ts>",
  "name": "Viva Mais - Individual",
  "frequency": "MONTHLY",              // Pix Automático aceita WEEKLY/MONTHLY/QUARTERLY/SEMIANNUALLY/ANNUALLY (BIMONTHLY não)
  "dayGenerateCharge": 25,             // dia do mês (1-31) OU data-hora UTC completa
  "dayDue": 7,                         // dias p/ expirar (min 3)
  "customer": { "name":"", "email":"", "phone":"", "taxID":"" },
  "pixRecurringOptions": {
    "journey": "PAYMENT_ON_APPROVAL",  // cobra já ao autorizar (vs ONLY_RECURRENCY = só autoriza)
    "retryPolicy": "THREE_RETRIES_7_DAYS"  // ou NON_PERMITED
  }
}
```
- `chargeType` (DYNAMIC/OVERDUE/BOLETO) só vale p/ `type: RECURRENT` — ignorado no PIX_RECURRING.
- `installmentCount` opcional (omitir = assinatura aberta).

**Resposta** — `subscription`:
- `globalID` → guardar como `gatewaySubscriptionId`.
- `pixRecurringOptions.emv` → **QR/BR Code de autorização** (renderizar p/ cliente escanear e autorizar no banco).
- `pixRecurringOptions.status`: CREATED → APPROVED → (CANCELED/EXPIRED/REJECTED).
- `subscription.status`: ACTIVE/COMPLETED/EXPIRED. `paymentLinkUrl` (link alternativo). `correlationID`.

**Webhooks**: `PIX_AUTOMATIC_APPROVED` (autorização aprovada), `PIX_AUTOMATIC_COBR_COMPLETED` (parcela paga).

**Config decisões (default)**: journey=PAYMENT_ON_APPROVAL, retryPolicy=THREE_RETRIES_7_DAYS, frequency=MONTHLY, dayDue=7.

### Ainda a confirmar em runtime (no deploy/sandbox)
1. Shape exato do payload dos webhooks `PIX_AUTOMATIC_*` (campos p/ casar subscription/installment).
2. Validação da assinatura do webhook (header `x-webhook-signature` + HMAC/public key).

## Mudanças no backend

### 1. Config / Admin
- `AppConfig`: `wooviEnabled` (bool), `wooviAppId` (varchar, secret — mascarar como a secret da Veenca),
  `wooviSandbox` (bool), `wooviWebhookKey` (varchar, secret).
- Novo campo `activeGateway` (`veenca` | `woovi`) — seletor de qual gateway cobra. Default `veenca` até virar a chave.
- Migração `AddWoovi...` (colunas nullable → `type` explícito, ver [[typeorm-nullable-column-type]]).
- `UpdateConfigDto` + admin.service (mascarar `wooviAppId`/`wooviWebhookKey` iguais à secret Veenca).
- UI Admin: inputs Woovi + toggle de gateway ativo (mesma aba do gateway atual).

### 2. WooviService (`src/payment/woovi.service.ts`)
Espelha a interface do `PaymentService` (Veenca):
- `isEnabled()`, `headers()` (`Authorization: appId`), base URL por `wooviSandbox`.
- `createSubscription(input)` → POST /subscriptions (Pix Automático). Retorna
  `{ ok, subscriptionId (globalID), installmentId, status, pixCode, pixImage }`.
- `getSubscription(id)` / `getInstallment(id)` → status para reconciliação.
- `cancelSubscription(id)`.
- `value` em **centavos** (Woovi) — converter de reais (Veenca usa reais).

### 3. Camada de gateway (abstração)
- Interface comum `PaymentGateway { createSubscription, getStatus, cancel }`.
- `BillingService` resolve o gateway ativo por `config.activeGateway` e chama a interface.
- `Transaction`: nova coluna `gatewayProvider` (`veenca`|`woovi`) pra saber quem processou
  (webhook/reconcile roteiam pelo provider). Mantém `gatewaySubscriptionId`, `gatewayTransactionId`.

### 4. Webhook Woovi
- Rota pública nova `POST /billing/webhook/woovi` (separada da Veenca).
- Validar assinatura (chave `wooviWebhookKey`) — corpo não confiável sem isso.
- `PIX_AUTOMATIC_APPROVED` → autorização OK (registrar; opcional: e-mail "assinatura autorizada").
- `PIX_AUTOMATIC_COBR_COMPLETED` → parcela paga:
  - 1ª parcela → `confirmPaid` (ativa conta + 3 benefícios + comissão + Vencca/ClubeCerto + e-mail).
  - Demais → renovação `vm-renew-` (fatura paga, sem comissão) — mesma lógica já feita p/ Veenca.
- Reaproveita `applyConfirmedStatus` / `recordRecurringCharge` adaptados ao provider.

### 5. Reconciliação (cron)
- Estender o cron atual: p/ transações Woovi pendentes, consultar
  `GET /subscriptions/{id}/installments` (ou `/installments/{id}`) e liquidar. Rede de segurança do webhook.

### 6. Frontend (checkout)
- Quando `activeGateway=woovi`: mostrar o **QR/BR Code de autorização** do Pix Automático +
  texto "Escaneie e **autorize a recorrência** no app do seu banco. A cobrança mensal é automática."
- Polling de status igual ao atual (assinatura ativa → libera).
- QR gerado do `code` via lib `qrcode` (já instalada), como no fluxo Veenca.

### 7. Deploy
- Migração + build + deploy backend (tar+base64+plink, ver [[acesso-saude-deploy]]).
- Registrar webhook no painel Woovi apontando p/ `https://conta.vivamaisclub.com/api/billing/webhook/woovi`.
- Ativar `wooviEnabled` + `activeGateway=woovi` no Admin quando validado em sandbox.

## Estratégia de corte
- Fase 1: sandbox — validar criação, autorização, débito de parcela, webhooks.
- Fase 2: prod com `activeGateway=woovi` para **novos** cadastros; assinaturas Veenca
  existentes seguem até migrarem naturalmente (ou migração manual depois).
- Veenca fica no código como fallback (não apaga nada).

## Riscos / dependências
- Pix Automático precisa estar **liberado na conta Woovi** (confirmar com suporte).
- Contrato exato do `POST /subscriptions` (campo Pix Automático) ainda não confirmado — trava o code final.
- Reconciliação respeitar rate limit da Woovi (checar limites da conta).
