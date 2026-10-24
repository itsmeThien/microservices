import { Router } from 'express';
import { customerClient, callGrpc, grpcToHttpError } from '../grpcClients.js';
import { authenticateJWT } from '../middleware/auth.js';

export const customerRouter = Router();

// GET /api/customers/:uid
customerRouter.get('/:uid', authenticateJWT, async (req, res) => {
  const targetUid = parseInt(req.params.uid, 10);

  if (isNaN(targetUid)) {
    return res.status(400).json({ error: 'BadRequest', message: 'Invalid uid parameter' });
  }

  // Authorization check
  if (req.user.role !== 'Admin' && req.user.uid !== targetUid) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You are not authorized to view another customer profile'
    });
  }

  try {
    const result = await callGrpc(customerClient, 'getCustomer', { uid: targetUid });
    return res.status(200).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});

// PUT /api/customers/:uid
customerRouter.put('/:uid', authenticateJWT, async (req, res) => {
  const targetUid = parseInt(req.params.uid, 10);
  const { fullname, mid } = req.body;

  if (isNaN(targetUid)) {
    return res.status(400).json({ error: 'BadRequest', message: 'Invalid uid parameter' });
  }

  if (!fullname) {
    return res.status(400).json({ error: 'BadRequest', message: 'fullname is required' });
  }

  if (req.user.role !== 'Admin' && req.user.uid !== targetUid) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You are not authorized to update another customer profile'
    });
  }

  try {
    const result = await callGrpc(customerClient, 'updateCustomer', {
      uid: targetUid,
      fullname,
      mid: mid ? parseInt(mid, 10) : 1
    });
    return res.status(200).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});
