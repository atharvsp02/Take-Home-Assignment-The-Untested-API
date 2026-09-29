const express = require('express');
const taskRoutes = require('./routes/tasks');

const app = express();

app.use(express.json());
app.use('/tasks', taskRoutes);

app.use((err, req, res, next) => {
  // Errors from middleware such as express.json() carry their own status
  // (400 for bad JSON, 413 for a body that is too large). Those are client
  // mistakes, so pass them on; only real server errors become a 500 (#7).
  const status = err.status || err.statusCode || 500;
  if (status < 500) {
    const message = err.type === 'entity.parse.failed' ? 'Request body is not valid JSON' : err.message;
    return res.status(status).json({ error: message });
  }

  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Task API running on port ${PORT}`);
  });
}

module.exports = app;
