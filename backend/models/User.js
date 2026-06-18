const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type:      String,
    required:  true,
    unique:    true,
    trim:      true,
    minlength: 3,
    maxlength: 16
  },
  email: {
    type:      String,
    required:  true,
    unique:    true,
    lowercase: true,
    trim:      true
  },
  password: {
    type:      String,
    required:  true
  },
  lastLogin: {
    type:    Date,
    default: null
  },
  banned: {
    type:    Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);