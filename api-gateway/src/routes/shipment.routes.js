import { Router } from 'express';
import { shipmentClient, callGrpc, grpcToHttpError } from '../grpcClients.js';
import { authenticateJWT, authorizeRoles } from '../middleware/auth.js';

export const shipmentRouter = Router();

// GET /api/shipments/:shipid
shipmentRouter.get('/:shipid', authenticateJWT, async (req, res) => {
  const shipid = parseInt(req.params.shipid, 10);
  if (isNaN(shipid)) {
    return res.status(400).json({ error: 'BadRequest', message: 'Invalid shipid parameter' });
  }

  try {
    const result = await callGrpc(shipmentClient, 'getShipment', { shipid });
    return res.status(200).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});

// PATCH /api/shipments/:shipid/status (Shipment Staff or Admin)
shipmentRouter.patch('/:shipid/status', authenticateJWT, authorizeRoles('Shipment Staff', 'Admin'), async (req, res) => {
  const shipid = parseInt(req.params.shipid, 10);
  const { status } = req.body;

  if (isNaN(shipid)) {
    return res.status(400).json({ error: 'BadRequest', message: 'Invalid shipid parameter' });
  }

  if (!status) {
    return res.status(400).json({ error: 'BadRequest', message: 'status field is required' });
  }

  try {
    const result = await callGrpc(shipmentClient, 'updateShipmentStatus', {
      shipid,
      status
    });

    return res.status(200).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});
