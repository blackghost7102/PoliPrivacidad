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
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Customers')
        CREATE TABLE Customers (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            FullName NVARCHAR(160) NOT NULL,
            Email NVARCHAR(254) NOT NULL UNIQUE,
            WhatsApp NVARCHAR(20) NOT NULL,
            CreatedAt DATETIME2 NOT NULL DEFAULT(SYSUTCDATETIME()),
            UpdatedAt DATETIME2 NOT NULL DEFAULT(SYSUTCDATETIME())
        );
    `);

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
        CREATE TABLE Orders (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            ExternalReference NVARCHAR(100) NOT NULL,
            CustomerId INT NULL,
            PayerName NVARCHAR(100) NULL,
            PayerLastName NVARCHAR(100) NULL,
            PayerEmail NVARCHAR(200) NULL,
            PayerPhone NVARCHAR(30) NULL,
            Status NVARCHAR(30) NOT NULL DEFAULT('pending'),
            PaymentMethod NVARCHAR(30) NOT NULL DEFAULT('MercadoPago'),
            FulfillmentStatus NVARCHAR(30) NOT NULL DEFAULT('pending'),
            ConsentAt DATETIME2 NULL,
            Total DECIMAL(10,2) NOT NULL,
            PreferenceId NVARCHAR(100) NULL,
            PaymentId NVARCHAR(100) NULL,
            CreatedAt DATETIME2 NOT NULL DEFAULT(SYSUTCDATETIME()),
            UpdatedAt DATETIME2 NOT NULL DEFAULT(SYSUTCDATETIME())
        );
    `);

    await pool.request().query(`
        IF COL_LENGTH('dbo.Orders', 'CustomerId') IS NULL
            ALTER TABLE Orders ADD CustomerId INT NULL;
        IF COL_LENGTH('dbo.Orders', 'PaymentMethod') IS NULL
            ALTER TABLE Orders ADD PaymentMethod NVARCHAR(30) NOT NULL CONSTRAINT DF_Orders_PaymentMethod DEFAULT('MercadoPago');
        IF COL_LENGTH('dbo.Orders', 'FulfillmentStatus') IS NULL
            ALTER TABLE Orders ADD FulfillmentStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_Orders_FulfillmentStatus DEFAULT('pending');
        IF COL_LENGTH('dbo.Orders', 'ConsentAt') IS NULL
            ALTER TABLE Orders ADD ConsentAt DATETIME2 NULL;
        IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_Orders_Customers')
            ALTER TABLE Orders ADD CONSTRAINT FK_Orders_Customers FOREIGN KEY (CustomerId) REFERENCES Customers(Id);
    `);

    await pool.request().query(`
        ;WITH LegacyCustomers AS (
            SELECT
                LOWER(LTRIM(RTRIM(PayerEmail))) AS Email,
                COALESCE(NULLIF(MAX(LTRIM(RTRIM(CONCAT(PayerName, ' ', PayerLastName)))), ''), 'Cliente histórico') AS FullName,
                COALESCE(MAX(PayerPhone), '') AS WhatsApp,
                ROW_NUMBER() OVER (PARTITION BY LOWER(LTRIM(RTRIM(PayerEmail))) ORDER BY MAX(CreatedAt) DESC) AS RowNumber
            FROM Orders
            WHERE CustomerId IS NULL AND PayerEmail IS NOT NULL AND LTRIM(RTRIM(PayerEmail)) <> ''
            GROUP BY LOWER(LTRIM(RTRIM(PayerEmail)))
        )
        INSERT INTO Customers (FullName, Email, WhatsApp)
        SELECT legacy.FullName, legacy.Email, legacy.WhatsApp
        FROM LegacyCustomers legacy
        WHERE legacy.RowNumber = 1
          AND NOT EXISTS (SELECT 1 FROM Customers customer WHERE LOWER(customer.Email) = legacy.Email);

        UPDATE orders
        SET CustomerId = customers.Id
        FROM Orders orders
        INNER JOIN Customers customers ON LOWER(customers.Email) = LOWER(LTRIM(RTRIM(orders.PayerEmail)))
        WHERE orders.CustomerId IS NULL AND orders.PayerEmail IS NOT NULL;
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

    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrderProofs')
        CREATE TABLE OrderProofs (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            OrderId INT NOT NULL UNIQUE FOREIGN KEY REFERENCES Orders(Id),
            OriginalName NVARCHAR(255) NOT NULL,
            ContentType NVARCHAR(40) NOT NULL,
            ImageData VARBINARY(MAX) NOT NULL,
            UploadedAt DATETIME2 NOT NULL DEFAULT(SYSUTCDATETIME())
        );
    `);

    console.log('Tablas Products, Customers, Orders, OrderItems y OrderProofs listas.');

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
