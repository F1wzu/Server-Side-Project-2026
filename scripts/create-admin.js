// Creates an admin account, or turns an existing account into an admin.
// Admins cannot be created through the website; this script is the only way.
//
//   npm run admin:create
//
// It asks for the email, and for a new account also the username and password.
// For automated use (deployment), set ADMIN_EMAIL, ADMIN_USERNAME and
// ADMIN_PASSWORD for that one command instead; do not save them in .env.
const readline = require('node:readline');
const prisma = require('../src/config/db');
const userModel = require('../src/models/user');
const { registerSchema } = require('../src/validation/auth');

function ask(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY) {
    throw new Error('No terminal to ask questions in. Set ADMIN_EMAIL, ADMIN_USERNAME and ADMIN_PASSWORD instead.');
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      // Print the question once, then nothing while the password is typed.
      rl._writeToOutput = (text) => {
        if (text.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

// Checks one field with the same rules as the register form.
function check(field, value) {
  const result = registerSchema.shape[field].safeParse(value);
  if (!result.success) throw new Error(`${field}: ${result.error.issues[0].message}`);
  return result.data;
}

async function main() {
  const email = check('email', process.env.ADMIN_EMAIL ?? (await ask('Email: ')));

  if (await userModel.emailExists(email)) {
    const { user } = await userModel.createOrPromoteAdmin({ email });
    console.log(`${user.email} already had an account. It is now an admin; its password is unchanged.`);
    return;
  }

  const username = check('username', process.env.ADMIN_USERNAME ?? (await ask('Username: ')));
  let password = process.env.ADMIN_PASSWORD;
  if (password === undefined) {
    password = await ask('Password (at least 8 characters, not shown): ', { hidden: true });
    if (password !== (await ask('Password again: ', { hidden: true }))) throw new Error('The two passwords are different.');
  }
  check('password', password);

  const { user } = await userModel.createOrPromoteAdmin({ username, email, password });
  console.log(`Admin account created for ${user.email}.`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
