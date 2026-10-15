const express = require('express');
const path = require('path');
const router = express.Router();

router.use('/uploads', require('./privateFiles'));
router.use('/', require('./privateFiles'));

module.exports = router;
