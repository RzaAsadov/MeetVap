import { NextFunction, Request, Response } from 'express';

import { MASK_HEADER, MASK_VERSION, unmaskPayload } from './payloadMask';

export function payloadMaskMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.header(MASK_HEADER) === MASK_VERSION && req.body && typeof req.body === 'object' && 'payload' in req.body) {
    const payload = (req.body as { payload?: unknown }).payload;

    if (typeof payload !== 'string') {
      res.status(400).json({ error: 'Invalid masked payload' });
      return;
    }

    try {
      req.body = unmaskPayload(payload);
    } catch {
      res.status(400).json({ error: 'Invalid masked payload' });
      return;
    }
  }

  next();
}
