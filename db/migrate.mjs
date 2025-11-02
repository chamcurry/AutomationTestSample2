import Postgrator from "postgrator";
import pg from "pg";
import { dirname } from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv"

// ローカル開発を優先するため、USE_LOCAL_DB環境変数で制御
// .envファイルを読み込む（システム環境変数を上書きする）
const useLocalDb = process.env.USE_LOCAL_DB === 'true' || process.argv.includes('--local');

if (useLocalDb) {
  // .envファイルの値を優先（システム環境変数を上書き）
  dotenv.config({ override: true });
  console.log('Using local database from .env file');
} else {
  // システム環境変数を優先（Railwayなどのクラウド環境用）
  dotenv.config();
  if (process.env.PGHOST && !process.env.PGHOST.includes('localhost')) {
    console.log(`Using remote database: ${process.env.PGHOST}`);
  }
}
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // Create a client of your choice
  // RailwayやクラウドデータベースではSSL接続が必要な場合があります
  const host = process.env.PGHOST || 'localhost';
  const isRemote = host && !host.includes('localhost') && !host.includes('127.0.0.1');
  
  // SSL設定：RailwayなどではSSLが必要だが、接続方法を改善
  let sslConfig = false;
  if (isRemote) {
    // Railwayなどのクラウドデータベース用
    // rejectUnauthorized: false で自己署名証明書を許可
    sslConfig = {
      rejectUnauthorized: false
    };
  }

  const clientConfig = {
    host: host,
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'develop',
    user: process.env.PGUSER || 'admin',
    password: process.env.PGPASSWORD || '',
    connectionTimeoutMillis: 60000, // 60秒に延長
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };

  // リモート接続の場合のみSSLを有効化
  if (isRemote && sslConfig) {
    clientConfig.ssl = sslConfig;
  }

  console.log(`Connection config: host=${clientConfig.host}, port=${clientConfig.port}, database=${clientConfig.database}, ssl=${!!clientConfig.ssl}`);

  const client = new pg.Client(clientConfig);

  try {
    // Establish a database connection
    console.log(`Connecting to ${clientConfig.host}:${clientConfig.port}/${clientConfig.database}...`);
    
    // 接続エラーを詳細にキャッチ
    await client.connect().catch((connectError) => {
      console.error('Connection failed:', connectError.message);
      console.error('Connection error code:', connectError.code);
      console.error('Connection error errno:', connectError.errno);
      throw connectError;
    });
    
    console.log('Database connection established');

    // 接続テストクエリを実行
    const testResult = await client.query('SELECT NOW() as current_time');
    console.log('Connection test successful, server time:', testResult.rows[0].current_time);

    // Create postgrator instance
    const postgrator = new Postgrator({
      migrationPattern: __dirname + "/migrations/*",
      driver: "pg",
      database: clientConfig.database,
      schemaTable: "schemaversion",
      execQuery: async (query) => {
        try {
          return await client.query(query);
        } catch (queryError) {
          console.error('Query error:', queryError.message);
          console.error('Query:', query);
          throw queryError;
        }
      },
    });

    console.log('Running migrations...');
    const result = await postgrator.migrate();
    if (result.length === 0) {
      console.log("No new migration file detected")
    } else {
      console.log('Migration succeeded!')
      console.log(`Applied ${result.length} migration(s)`);
    }
  } catch (error) {
    // If error happened partially through migrations,
    // error object is decorated with appliedMigrations
    console.error('Migration error:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    // 接続エラーの場合、アプリケーション起動時に再試行できるよう0で終了
    // （ビルド時の接続エラーを回避するため）
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      console.warn('Database connection failed during migration. This is expected during build time.');
      console.warn('Migrations will be run at application startup.');
      process.exit(0);
    }
    process.exit(1);
  } finally {
    // Once done migrating, close your connection.
    try {
      await client.end();
      console.log('Database connection closed');
    } catch (err) {
      console.error('Error closing connection:', err.message);
    }
  }
}
main();
