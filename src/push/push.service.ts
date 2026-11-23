import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createSign } from 'crypto';
import { readFileSync } from 'fs';
import { Repository } from 'typeorm';
import { PushDevice } from './entities/push-device.entity';
import { PushBroadcast } from './entities/push-broadcast.entity';
import { PUSH_APPS, PushApp } from './push-apps';

/** Notificação mostrada no celular. `tab` abre essa aba do app ao tocar. */
export interface PushMessage {
  title: string;
  body: string;
  tab?: string;
  data?: Record<string, string>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/**
 * Notificações nativas do app (Firebase Cloud Messaging, API HTTP v1).
 * Credencial: arquivo JSON da conta de serviço do Firebase no caminho de
 * FCM_SERVICE_ACCOUNT_FILE. Sem o arquivo o envio fica desligado (só registra log).
 * Best-effort: falha de push nunca derruba pagamento/renovação.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private account: ServiceAccount | null | undefined;
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    @InjectRepository(PushDevice) private devicesRepo: Repository<PushDevice>,
    @InjectRepository(PushBroadcast) private broadcastsRepo?: Repository<PushBroadcast>,
  ) {}

  async registerDevice(userId: number, token: string, platform = 'android', app: PushApp = 'vivamais') {
    const existing = await this.devicesRepo.findOne({ where: { token } });
    if (existing) {
      existing.userId = userId;
      existing.platform = platform;
      existing.app = app;
      existing.updatedAt = new Date();
      await this.devicesRepo.save(existing);
    } else {
      await this.devicesRepo.save(this.devicesRepo.create({ userId, token, platform, app }));
    }
    return { ok: true };
  }

  /** Logout: o celular para de receber as notificações dessa conta. */
  async unregisterDevice(userId: number, token: string) {
    await this.devicesRepo.delete({ userId, token });
    return { ok: true };
  }

  /** Envia para todos os celulares do usuário. Retorna quantos aceitaram. */
  async sendToUser(userId: number, message: PushMessage): Promise<number> {
    try {
      const account = this.loadAccount();
      if (!account) return 0;
      const devices = await this.devicesRepo.find({ where: { userId } });
      if (!devices.length) return 0;
      const token = await this.getAccessToken(account);
      let sent = 0;
      for (const device of devices) {
        if (await this.sendToDevice(account, token, device, message)) sent += 1;
      }
      if (sent) this.logger.log(`Push "${message.title}" enviado (user ${userId}, ${sent} celular(es)).`);
      return sent;
    } catch (err) {
      this.logger.warn(`Push "${message.title}" falhou (user ${userId}): ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Admin: manda a mesma notificação para todos os celulares de um app (ex.: novidades
   * do Kids). Envia em lotes paralelos e guarda no histórico quantos o Firebase aceitou.
   */
  async broadcast(app: PushApp, title: string, body: string, adminId: number | null = null) {
    const account = this.loadAccount();
    if (!account) throw new Error('Notificações desligadas no servidor (falta a credencial do Firebase).');
    const devices = await this.devicesRepo.find({ where: { app } });
    let sent = 0;
    if (devices.length) {
      const token = await this.getAccessToken(account);
      const message: PushMessage = { title, body };
      for (let i = 0; i < devices.length; i += 20) {
        const results = await Promise.all(
          devices.slice(i, i + 20).map((d) => this.sendToDevice(account, token, d, message).catch(() => false)),
        );
        sent += results.filter(Boolean).length;
      }
    }
    this.logger.log(`Push em massa "${title}" (${app}): ${sent}/${devices.length} celular(es).`);
    const record = this.broadcastsRepo
      ? await this.broadcastsRepo.save(this.broadcastsRepo.create({ app, title, body, total: devices.length, sent, createdById: adminId }))
      : null;
    return { id: record?.id ?? null, app, total: devices.length, sent };
  }

  /** Admin: celulares cadastrados por app e os últimos envios. */
  async adminSummary() {
    const rows = await this.devicesRepo
      .createQueryBuilder('d')
      .select('d.app', 'app')
      .addSelect('COUNT(*)', 'total')
      .groupBy('d.app')
      .getRawMany<{ app: string; total: string }>();
    const devices = Object.fromEntries(PUSH_APPS.map((a) => [a, 0])) as Record<PushApp, number>;
    for (const r of rows) if (r.app in devices) devices[r.app as PushApp] = Number(r.total);
    const history = this.broadcastsRepo
      ? await this.broadcastsRepo.find({ order: { createdAt: 'DESC' }, take: 30 })
      : [];
    return { enabled: !!this.loadAccount(), devices, history };
  }

  private async sendToDevice(account: ServiceAccount, accessToken: string, device: PushDevice, message: PushMessage) {
    const data: Record<string, string> = { ...(message.data ?? {}) };
    if (message.tab) data.tab = message.tab;
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: device.token,
          notification: { title: message.title, body: message.body },
          data,
          android: { priority: 'HIGH', notification: { channel_id: 'default', sound: 'default' } },
        },
      }),
    });
    if (res.ok) return true;
    const text = await res.text();
    // App desinstalado / token trocado: tira o celular da lista.
    if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(text)) {
      await this.devicesRepo.delete({ id: device.id });
      return false;
    }
    this.logger.warn(`FCM HTTP ${res.status} (device ${device.id}): ${text.slice(0, 300)}`);
    return false;
  }

  private loadAccount(): ServiceAccount | null {
    if (this.account !== undefined) return this.account;
    const file = process.env.FCM_SERVICE_ACCOUNT_FILE;
    if (!file) {
      this.logger.warn('FCM_SERVICE_ACCOUNT_FILE não definido — notificações push desligadas.');
      this.account = null;
      return null;
    }
    try {
      const json = JSON.parse(readFileSync(file, 'utf8'));
      this.account = { project_id: json.project_id, client_email: json.client_email, private_key: json.private_key };
    } catch (err) {
      this.logger.error(`Credencial do Firebase ilegível (${file}): ${(err as Error).message}`);
      this.account = null;
    }
    return this.account;
  }

  /** Token OAuth da conta de serviço (JWT assinado RS256), reaproveitado até perto de expirar. */
  private async getAccessToken(account: ServiceAccount): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
    if (!res.ok) throw new Error(`OAuth Google HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }
}
