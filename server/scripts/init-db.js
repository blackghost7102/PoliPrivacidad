/* Crea la base de datos DigitalRO (si no existe), sus tablas y sincroniza el catálogo desde data/products.json */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const { buildConfig } = require('../db');

async function run() {
    const dbName = process.env.DB_NAME || 'DigitalRO';

    if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
        throw new Error('Faltan DB_USER o DB_PASSWORD en server/.env');
    }

    console.log(`Conectando a ${process.env.DB_SERVER} (master)...`);
    const masterPool = await sql.connect(buildConfig('master'));
    await masterPool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = '${dbName}')
        CREATE DATABASE [${dbName}];
    `);
    await masterPool.close();
    console.log(`Base de datos "${dbName}" lista.`);

    const pool = await sql.connect(buildConfig(dbName));

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
        CREATE TABLE Products (
            Id NVARCHAR(60) PRIMARY KEY,
            Category NVARCHAR(30) NOT NULL,
            Title NVARCHAR(200) NOT NULL,
            Platform NVARCHAR(30) NOT NULL,
            Type NVARCHAR(30) NOT NULL,
            Price DECIMAL(10,2) NOT NULL,
            Logo NVARCHAR(300) NOT NULL,
            Color NVARCHAR(20) NOT NULL
        );
    `);

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
        CREATE TABLE Orders (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            ExternalReference NVARCHAR(100) NOT NULL,
            PayerName NVARCHAR(100) NULL,
            PayerLastName NVARCHAR(100) NULL,
            PayerEmail NVARCHAR(200) NULL,
            PayerPhone NVARCHAR(30) NULL,
            Status NVARCHAR(30) NOT NULL DEFAULT('pending'),
            Total DECIMAL(10,2) NOT NULL,
            PreferenceId NVARCHAR(100) NULL,
            PaymentId NVARCHAR(100) NULL,
            CreatedAt DATETIME2 NOT NULL DEFAULT(SYSUTCDATETIME()),
            UpdatedAt DATETIME2 NOT NULL DEFAULT(SYSUTCDATETIME())
        );
    `);

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrderItems')
        CREATE TABLE OrderItems (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            OrderId INT NOT NULL FOREIGN KEY REFERENCES Orders(Id),
            ProductId NVARCHAR(60) NOT NULL,
            Title NVARCHAR(200) NOT NULL,
            Quantity INT NOT NULL,
            UnitPrice DECIMAL(10,2) NOT NULL
        );
    `);

    console.log('Tablas Products, Orders y OrderItems listas.');

    const productsPath = path.join(__dirname, '..', '..', 'data', 'products.json');
    const products = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));

    for (const p of products) {
        await pool.request()
            .input('id', sql.NVarChar(60), p.id)
            .input('category', sql.NVarChar(30), p.category)
            .input('title', sql.NVarChar(200), p.title)
            .input('platform', sql.NVarChar(30), p.platform)
            .input('type', sql.NVarChar(30), p.type)
            .input('price', sql.Decimal(10, 2), p.price)
            .input('logo', sql.NVarChar(300), p.logo)
            .input('color', sql.NVarChar(20), p.color)
            .query(`
                MERGE Products AS target
                USING (SELECT @id AS Id) AS source
                ON target.Id = source.Id
                WHEN MATCHED THEN UPDATE SET
                    Category = @category, Title = @title, Platform = @platform,
                    Type = @type, Price = @price, Logo = @logo, Color = @color
                WHEN NOT MATCHED THEN
                    INSERT (Id, Category, Title, Platform, Type, Price, Logo, Color)
                    VALUES (@id, @category, @title, @platform, @type, @price, @logo, @color);
            `);
    }

    console.log(`${products.length} productos sincronizados en la tabla Products.`);
    await pool.close();
    console.log('Inicialización completada.');
}

run().catch((err) => {
    console.error('Error inicializando la base de datos:', err.message);
    process.exit(1);
});
