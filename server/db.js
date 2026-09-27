/* Pool de conexión reutilizable hacia SQL Server, configurado desde server/.env */

const sql = require('mssql');

function parseServer(rawServer) {
    if (!rawServer) return { server: 'localhost', instanceName: undefined };
    const [server, instanceName] = rawServer.split('\\');
    return { server, instanceName };
}

function buildConfig(database) {
    const { server, instanceName } = parseServer(process.env.DB_SERVER);
    return {
        server,
        database,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        options: {
            encrypt: process.env.DB_ENCRYPT === 'true',
            trustServerCertificate: true,
            instanceName
        }
    };
}

let poolPromise = null;

function getPool() {
    if (!poolPromise) {
        poolPromise = sql.connect(buildConfig(process.env.DB_NAME || 'DigitalRO')).catch((err) => {
            poolPromise = null;
            throw err;
        });
    }
    return poolPromise;
}

module.exports = { sql, getPool, buildConfig };
