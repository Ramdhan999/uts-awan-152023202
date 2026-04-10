const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const mysql = require('mysql2');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

// Setup Multer buat nyimpen file sementara sebelum dilempar ke S3
const upload = multer({ dest: 'uploads/' });

// Setup Koneksi AWS S3
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

// Setup Koneksi Database RDS MySQL
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Bikin Tabel Otomatis kalau belum ada di RDS
const createTableQuery = `
    CREATE TABLE IF NOT EXISTS laporan (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lokasi VARCHAR(255) NOT NULL,
        deskripsi TEXT NOT NULL,
        foto_url VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`;
db.query(createTableQuery, (err) => {
    if (err) console.error("❌ Gagal bikin tabel RDS:", err);
    else console.log("✅ Tabel Database RDS Aman!");
});

// HALAMAN UTAMA: Ambil data dari RDS terus tampilin
app.get('/', (req, res) => {
    db.query('SELECT * FROM laporan ORDER BY id DESC', (err, results) => {
        if (err) {
            console.error(err);
            return res.send("Error ngambil data dari database");
        }
        res.render('index', { laporan: results });
    });
});

// ENDPOINT TERIMA LAPORAN: Upload S3 -> Simpan RDS
app.post('/lapor', upload.single('foto'), (req, res) => {
    const { lokasi, deskripsi } = req.body;
    const file = req.file;

    if (!file) return res.send("Fotonya lupa diupload bro!");

    // Konfigurasi file buat S3
    const fileStream = fs.createReadStream(file.path);
    const s3Params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: `foto-sampah/${Date.now()}-${file.originalname}`,
        Body: fileStream,
        ContentType: file.mimetype
    };

    // 1. Upload ke S3
    s3.upload(s3Params, (err, data) => {
        // Hapus file sementara di laptop
        fs.unlinkSync(file.path); 

        if (err) {
            console.error("❌ Error S3:", err);
            return res.send("Gagal upload foto ke AWS S3");
        }

        const fotoUrl = data.Location; // Ini link foto dari AWS S3

        // 2. Simpan Data ke RDS MySQL
        const sql = 'INSERT INTO laporan (lokasi, deskripsi, foto_url) VALUES (?, ?, ?)';
        db.query(sql, [lokasi, deskripsi, fotoUrl], (dbErr) => {
            if (dbErr) {
                console.error("❌ Error RDS:", dbErr);
                return res.send("Gagal simpan data ke Database RDS");
            }
            
            console.log("✅ Laporan baru berhasil masuk!");
            res.redirect('/'); // Balik ke halaman utama kalau sukses
        });
    });
});

app.listen(port, () => {
    console.log(`🚀 Server jalan di http://localhost:${port}`);
});