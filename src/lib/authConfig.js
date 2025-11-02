import { Authenticator } from "@fastify/passport";
import session from "@fastify/session";
import cookie from "@fastify/cookie";
import LocalStrategy from "passport-local"
import connectPgSimple from "connect-pg-simple"
import hashPassword from "./hashPassword.js";
import pg from 'pg';

export default async function authConfig(server) {
  const passport = new Authenticator();
  server.register(cookie);
  
  // Railwayなどのクラウド環境ではSSL接続が必要な場合がある
  const host = process.env.PGHOST || 'localhost';
  const isRemote = host && !host.includes('localhost') && !host.includes('127.0.0.1');
  
  const pgPoolConfig = {
    host: host,
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    max: 20,
  };
  
  // リモート接続の場合、SSL設定を追加
  if (isRemote) {
    pgPoolConfig.ssl = {
      rejectUnauthorized: false
    };
    console.log(`セッションストア用PostgreSQL接続設定: host=${host}, port=${pgPoolConfig.port}, database=${pgPoolConfig.database}, ssl=true`);
  } else {
    console.log(`セッションストア用PostgreSQL接続設定: host=${host}, port=${pgPoolConfig.port}, database=${pgPoolConfig.database}, ssl=false`);
  }
  
  const pgPool = new pg.Pool(pgPoolConfig);
  
  // 接続テスト（エラー時も続行）
  try {
    const testClient = await pgPool.connect();
    testClient.release();
    console.log('セッションストア用PostgreSQL接続成功');
  } catch (err) {
    console.error('セッションストア用PostgreSQL接続エラー:', err.message);
    console.error('エラーコード:', err.code);
    console.error('エラースタック:', err.stack);
    // エラーをthrowしない（接続プールが後で再接続を試みる）
    console.warn('セッションストアの接続エラーは無視して続行します（接続プールが自動的に再試行します）');
  }
  const pgSession = new connectPgSimple(session)
  // allow insecure cookie only during development
  server.register(session, {
    secret: process.env.SESSION_SECRET,
    store: new pgSession({
      pool: pgPool
    }),
    cookie: process.env.NODE_ENV == "development" ? { secure: false } : {},
  });

  server.register(passport.initialize());
  server.register(passport.secureSession());

  passport.use(
    "local",
    new LocalStrategy(async function (username, password, done) {
      const client = await server.pg.connect();

      const { rows } = await client.query("SELECT id, username, password FROM users WHERE username = $1", [username])
      const user = rows[0]
      client.release()
      if (!user) {
        return done(null, false)
      }

      const hashedPassword = await hashPassword(password)
      if (hashedPassword === user.password) {
        return done(null, user)
      }

      return done(null, false);
    })
  );

  passport.registerUserSerializer(async (user, request) => user.id);
  passport.registerUserDeserializer(async (id,  request) => {
    const client = await server.pg.connect();
    const { rows } = await client.query('SELECT id, username, is_admin, fullname, tel FROM users WHERE id = $1', [id])
    const user = rows[0]
    client.release()
    return {
      id: user.id,
      username: user.username,
      isAdmin: user.is_admin,
      fullname: user.fullname,
      tel: user.tel
    }
  });

  return passport
}


