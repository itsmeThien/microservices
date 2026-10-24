import { Router } from 'express';
import { authClient, callGrpc, grpcToHttpError } from '../grpcClients.js';

export const authRouter = Router();

// POST /api/auth/register
authRouter.post('/register', async (req, res) => {
  const { username, password, email, phone } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'username and password are required'
    });
  }

  try {
    const result = await callGrpc(authClient, 'register', {
      username,
      password,
      email: email || '',
      phone: phone || ''
    });

    return res.status(201).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});

// POST /api/auth/login
authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'username and password are required'
    });
  }

  try {
    const result = await callGrpc(authClient, 'login', {
      username,
      password
    });

    return res.status(200).json(result);
  } catch (err) {
    const { status, body } = grpcToHttpError(err);
    return res.status(status).json(body);
  }
});
