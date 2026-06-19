import { defineEventHandler } from 'h3';
import { LABELS } from '~~/server/utils/label';

export default defineEventHandler(() => ({
  company: { ...LABELS.company },
  app: { ...LABELS.app },
}));
