import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET;

// 1. Token Verification Layer
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ error: "Authentication failed. Invalid token." });
  }
};

// 2. Admin Verification Layer (Moved here!)
export const verifyAdmin = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json({ error: "Access denied. Token verification failed." });
  }
  if (req.user.role !== "admin") {
    return res
      .status(403)
      .json({ error: "Access Denied: Administrative privileges required." });
  }
  next();
};
