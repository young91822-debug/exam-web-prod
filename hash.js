const crypto = require("crypto");

function makePasswordHash(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

console.log(makePasswordHash("1234"));
