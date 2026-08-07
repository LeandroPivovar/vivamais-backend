import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Activity } from './entities/activity.entity';

function formatDateTime(date: Date): string {
  const datePart = date.toLocaleDateString('pt-BR');
  const timePart = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} às ${timePart}`;
}

@Injectable()
export class ActivitiesService {
  constructor(@InjectRepository(Activity) private repo: Repository<Activity>) {}

  async list(userId: number) {
    const activities = await this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    return activities.map((a) => ({ desc: a.desc, date: formatDateTime(a.createdAt), type: a.type }));
  }

  async record(userId: number, desc: string, type: Activity['type']) {
    const activity = this.repo.create({ userId, desc, type });
    return this.repo.save(activity);
  }
}
