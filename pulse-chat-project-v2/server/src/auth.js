import jwt from 'jsonwebtoken';
export const issueToken = id => jwt.sign({sub:id}, process.env.JWT_SECRET, {expiresIn:process.env.JWT_EXPIRES_IN || '7d'});
export const requireAuth = (req,res,next) => { try { req.userId=jwt.verify((req.headers.authorization||'').replace('Bearer ',''),process.env.JWT_SECRET).sub; next(); } catch { res.status(401).json({error:'Authentication required'}); } };
export const socketAuth = (socket,next) => { try { socket.userId=jwt.verify(socket.handshake.auth?.token,process.env.JWT_SECRET).sub; next(); } catch { next(new Error('Unauthorized')); } };
