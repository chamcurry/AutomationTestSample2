import fastify from "fastify";
import view from "@fastify/view"
import postgres from "@fastify/postgres"
import formbody from "@fastify/formbody"
import ejs from "ejs"
import authConfig from "./lib/authConfig.js";
import loginRoutes from "./routes/login.js";
import itemRoutes from "./routes/items.js";
import orderRoutes from "./routes/order.js";
import signUpRoutes from "./routes/signUp.js";
import publicRoutes from "./routes/public.js";
import * as dotenv from "dotenv"
import usersRoute from "./routes/users.js";
import path from 'path'

dotenv.config()
const server = fastify();

server.register(view, {
  engine: {
    ejs: ejs
  }
})

server.register(formbody)

// Railwayなどのクラウド環境ではSSL接続が必要な場合がある
const host = process.env.PGHOST || 'localhost';
const isRemote = host && !host.includes('localhost') && !host.includes('127.0.0.1');

const connectionString = `postgres://${process.env.PGUSER}:${process.env.PGPASSWORD}@${host}:${process.env.PGPORT}/${process.env.PGDATABASE}`;

const postgresConfig = {
  connectionString
};

// リモート接続の場合、SSL設定を追加
if (isRemote) {
  postgresConfig.ssl = {
    rejectUnauthorized: false
  };
}

await server.register(postgres, postgresConfig)

const passport = await authConfig(server)

// Routes
server.register(loginRoutes, { passport })
server.register(itemRoutes, { passport })
server.register(orderRoutes, { passport })
server.register(signUpRoutes, { passport })
server.register(usersRoute, { passport })
server.register(publicRoutes, { passport })

server.get('/', (request, reply) => {
  reply.redirect(302, '/items')
})

server.setErrorHandler(async (error, request, reply) => {
  console.error('エラー発生:', error);
  console.error('エラースタック:', error.stack);
  reply.status(500).send({ 
    statusCode: 500, 
    error: 'Internal Server Error', 
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
});

server.listen({ host: '0.0.0.0', port: process.env.PORT || 8080 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
