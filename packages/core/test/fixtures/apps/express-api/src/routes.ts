import { Router } from 'express';
export const router = Router();
router.get('/orders', list);
router.post('/orders', create);
router.get('/orders/:id', getOne);
router.delete('/orders/:id', remove);
router.get('/health', (_req, res) => res.json({ ok: true }));
