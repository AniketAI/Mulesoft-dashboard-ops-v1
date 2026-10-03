const authMiddleware = (req, res, next) => {
  if (!req.session || !req.session.token) {
    return res.status(401).json({ error: 'Unauthorized. Please login first.' });
  }
  req.anypointToken = req.session.token;
  req.orgId = req.session.orgId;
  req.memberOrgs = req.session.memberOrgs || [];
  req.accessibleEnvironments = req.session.accessibleEnvironments || {};
  next();
};

module.exports = authMiddleware;