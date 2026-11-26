# MedReminder: server (buka di VS Code)

Folder ini berisi server API Node.js. Aplikasi pasien, website pengawas, dan database ada di folder **medreminder-xampp**.

## Menjalankan

1. **Siapkan XAMPP dulu** (lihat README di medreminder-xampp): Apache dan MySQL menyala, `database/schema.sql` sudah diimpor.

2. **Buka folder ini di VS Code**: File → Open Folder → pilih `medreminder-vscode`.

3. **Buka terminal** (Terminal → New Terminal) dan jalankan:
   ```
   npm install
   npm start
   ```
   Kalau berhasil, muncul:
   ```
   MedReminder berjalan di http://localhost:3000
   Database tersambung.
   ```
   Kalau muncul `Database belum siap`, buka `http://localhost:3000/api/health` untuk melihat penyebabnya.

4. **Buka** `http://localhost/medreminder`.

Biarkan terminal tetap terbuka selama aplikasi dipakai. Untuk menghentikan server, tekan `Ctrl + C`.

## Pengaturan (.env)

Berkas `.env` sudah diisi untuk MySQL bawaan XAMPP (user `root`, tanpa password, database `medreminder`) dan sudah berisi `JWT_SECRET` acak. Kalau MySQL kamu memakai password, isi `DB_PASSWORD`.

## Cara kerja jadwal

- Pasien menulis aturan minum (`3x1`), jam minum pertama, tanggal mulai, dan lama minum.
- Server membuat satu baris di tabel `doses` untuk setiap dosis: dosis pertama pada jam minum pertama, lalu tiap 24 jam dibagi kali sehari. Jam dihitung dengan zona waktu pasien (disimpan saat mendaftar).
- Saat obat diubah, hanya dosis mendatang yang dibuat ulang. Riwayat tidak berubah.
- Setiap menit, server mencatat dosis yang lewat 30 menit tanpa konfirmasi sebagai `terlewat`.
- Konfirmasi dari perangkat hanya berstatus `diminum` dan wajib menyertakan tantangan pose dari swafoto. Status `dilewati` ditolak. Konfirmasi diterima selama waktu konfirmasinya masih di dalam 30 menit jadwal, walau dikirim terlambat karena offline. Server mencatat waktunya sendiri, dan memberi catatan bila jam perangkat selisih lebih dari 5 menit.
- Stok berkurang sebanyak jumlah tiap minum setiap kali dosis diminum.

| Aturan | Jarak  | Contoh dari 06:00          |
|--------|--------|----------------------------|
| 2x1    | 12 jam | 06:00, 18:00               |
| 3x1    | 8 jam  | 06:00, 14:00, 22:00        |
| 4x1    | 6 jam  | 06:00, 12:00, 18:00, 00:00 |

## Isi folder

```
medreminder-vscode/
├── .env                  Pengaturan database dan rahasia JWT
├── .env.example
├── package.json
└── src/
    ├── server.js         Titik masuk server + penanda dosis terlewat tiap menit
    ├── db.js             Koneksi MySQL
    ├── auth.js           Token JWT
    ├── lib/
    │   ├── medication.js Model obat: inheritance, getter/setter, kontrak, collection
    │   ├── schedule.js   Aturan minum, zona waktu, daftar waktu dosis
    │   └── doses.js      Membuat ulang jadwal, menandai terlewat, ringkasan kepatuhan
    └── routes/
        ├── auth.js          Daftar, masuk, profil
        ├── medications.js   Obat: tambah, ubah, isi ulang stok, hapus
        ├── doses.js         Jadwal, riwayat, sinkronisasi konfirmasi
        └── supervisors.js   Tautan pengawas + data website pengawas
```

## Contoh konsep OOP

Backend ini memakai JavaScript, jadi beberapa konsep ditulis sebagai pola runtime/JSDoc, bukan fitur tipe bawaan:

- `Medication` mewarisi `AbstractMedication`; kelas dasar menolak instansiasi langsung dan meminta subclass menyediakan `toJSON()`.
- Getter/setter `name` dan `stock` menyediakan akses properti dengan validasi.
- `assertImplements` memeriksa kontrak objek saat runtime sebagai simulasi interface. JavaScript tidak memiliki deklarasi `interface` bawaan.
- `Collection` memakai `@template T` JSDoc sebagai pola generic untuk dokumentasi tipe/editor; pemeriksaan tipe JavaScript perlu diaktifkan secara terpisah. JavaScript sendiri tidak menerapkan generic saat runtime.
- `Dictionary` memakai `Map` untuk pasangan kunci-nilai, dengan operasi `set`, `get`, `has`, dan `keys`; kelas ini digunakan untuk mengumpulkan nama obat unik pada ringkasan pengawas.
- Variabel (`const`/`let`) digunakan di seluruh route untuk menyimpan input, hasil query, dan data respons.

## Daftar API

Semua alamat diawali `http://localhost:3000/api`. Kecuali daftar dan masuk, kirim header `Authorization: Bearer <token>`.

| Metode | Alamat | Untuk | Isi |
|---|---|---|---|
| GET | `/health` | semua | Cek server dan tabel database |
| POST | `/auth/register` | semua | `{ name, email, password, role, consent, timezone }`; pasien wajib `consent: true` |
| POST | `/auth/login` | semua | `{ email, password, role }` → `{ token, user }` |
| GET | `/auth/me` | semua | Akun yang sedang masuk |
| GET | `/medications` | pasien | Obat aktif, termasuk jam minum, tanggal selesai, stok cukup berapa hari |
| POST | `/medications` | pasien | `{ name, type, unit, note, rule, first_time, start_date, duration_days, stock, min_stock }` |
| PUT | `/medications/:id` | pasien | Isi sama seperti POST; jadwal mendatang dibuat ulang bila jadwal berubah |
| POST | `/medications/:id/refill` | pasien | `{ amount }` menambah stok |
| DELETE | `/medications/:id` | pasien | Nonaktifkan obat, hapus jadwal mendatang |
| GET | `/doses?from=ISO&to=ISO` | pasien | Jadwal dosis dalam rentang waktu (maks. 14 hari) |
| GET | `/doses/history?days=30` | pasien | Dosis selesai + ringkasan kepatuhan |
| POST | `/doses/sync` | pasien | Kirim konfirmasi (contoh di bawah) |
| GET/POST | `/links` | pasien | Lihat / tautkan pengawas `{ email }` |
| DELETE | `/links/:supervisorId` | pasien | Lepas tautan |
| GET | `/supervisor/overview` | pengawas | Hal yang perlu perhatian + ringkasan tiap pasien |
| GET | `/supervisor/patients/:id` | pengawas | Kepatuhan 7/30 hari, 14 hari per tanggal, jadwal hari ini, obat |
| GET | `/supervisor/patients/:id/doses` | pengawas | Riwayat (maks. 100). Filter: `days`, `status`, `medication_id`, `warning=1` |

Contoh `POST /doses/sync`:
```json
{
  "sent_at": "2026-11-17T06:40:05Z",
  "updates": [
    { "dose_id": 12, "status": "diminum", "device_time": "2026-11-17T06:40:01Z",
      "pose": "Acungkan jempol", "face_check": "ok" }
  ]
}
```
Balasan berisi status akhir setiap dosis. Kiriman ulang untuk dosis yang sudah tercatat diabaikan, jadi aman diulang.

## Sebelum dipakai sungguhan

- Jalankan lewat HTTPS dan isi `CORS_ORIGIN` dengan alamat website.
- Batasi percobaan login, misalnya dengan paket `express-rate-limit`.
- Aplikasi Android (alarm di HP saat aplikasi tertutup) belum dibuat; API di atas sudah siap dipakai olehnya.
