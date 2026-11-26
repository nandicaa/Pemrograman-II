# MedReminder: aplikasi pasien, website pengawas, dan database (untuk XAMPP)

Folder ini berisi semua halaman yang dibuka di browser dan berkas database. Server API ada di folder **medreminder-vscode**.

## Memasang

1. **Salin folder ini ke htdocs** lalu ganti namanya menjadi `medreminder`:
   ```
   C:\xampp\htdocs\medreminder\
   ```

2. **Nyalakan XAMPP**: di XAMPP Control Panel, klik **Start** pada **Apache** dan **MySQL**.

3. **Buat database**:
   - Buka `http://localhost/phpmyadmin`
   - Klik tab **Import**, pilih `C:\xampp\htdocs\medreminder\database\schema.sql`, klik **Import**.
   - Database `medreminder` dengan empat tabel akan muncul di kiri.

   Berkas ini menghapus tabel MedReminder lama lalu membuatnya ulang. Kalau kamu sudah mengimpor versi sebelumnya, **impor ulang** berkas ini karena susunan tabelnya berubah.

4. **Jalankan server** dari folder medreminder-vscode (`npm install`, lalu `npm start`).

5. **Buka** `http://localhost/medreminder`. Bagian "Pemeriksaan sistem" di halaman itu menunjukkan apakah server, database, dan kamera sudah siap.

## Alur pemakaian

1. **Pengawas mendaftar** di `http://localhost/medreminder/pengawas/`.
2. **Pasien mendaftar** di `http://localhost/medreminder/pasien/`. Persetujuan penggunaan data ada di formulir pendaftaran.
3. Layar **Hari ini** pasien menampilkan **Langkah awal**:
   - Tambah obat: tulis aturan minum (mis. `3x1`) dan jam minum pertama. Server membuat jadwal untuk seluruh lama minum.
   - Aktifkan suara dan notifikasi: browser baru mengizinkan suara setelah ada klik.
   - Coba kamera: memastikan swafoto bisa diambil, karena setiap dosis wajib dikonfirmasi dengan foto.
   - Tautkan pengawas (opsional): di menu **Pengawas**, masukkan email pengawas.
4. **Saat jadwal tiba**, alarm berbunyi dan diulang tiap 5 menit selama 30 menit. Pasien menekan **Ambil foto dan konfirmasi**, mengikuti tantangan pose, lalu berswafoto sambil memegang obat. **Swafoto wajib**: tidak ada cara lain untuk mencatat dosis. Pasien bisa menekan **Ingatkan lagi 5 menit lagi** kalau belum siap.
5. Lewat 30 menit tanpa konfirmasi, **server** mencatat dosis itu terlewat, sehingga pengawas tetap melihatnya walau aplikasi pasien tidak dibuka.
6. **Pengawas** melihat panel **Perlu perhatian** (dosis terlewat 24 jam, stok menipis, jam perangkat tidak sesuai), daftar pasien, lalu detail tiap pasien: jadwal hari ini, obat dan stok, kepatuhan 14 hari, dan riwayat dengan filter.

## Isi folder

```
medreminder/                 (di dalam htdocs)
├── index.html               Halaman awal: pilih peran + pemeriksaan sistem
├── pasien/                  Aplikasi pasien
│   ├── index.html
│   └── app.js
├── pengawas/                Website pengawas
│   ├── index.html
│   └── app.js
├── shared/
│   ├── common.js            Alamat server API dan fungsi bersama
│   └── style.css            Tampilan bersama
└── database/
    └── schema.sql           Tabel MySQL: users, medications, doses, supervisor_links
```

## Hal yang perlu diketahui

- **Alarm hanya berbunyi selama halaman pasien terbuka** di browser. Ini batasan versi web. Aplikasi Android nantinya bisa menjadwalkan alarm di HP memakai API yang sama.
- **Kamera hanya bisa dipakai** lewat `http://localhost` atau `https://`. Kalau aplikasi pasien dibuka dari HP lewat alamat IP (mis. `http://192.168.1.5/medreminder/pasien/`), kamera diblokir browser dan dosis tidak bisa dikonfirmasi. Untuk dipakai dari HP, pasang HTTPS di XAMPP. Di layar **Langkah awal** ada tombol **Coba kamera** untuk memastikan kamera berfungsi sebelum alarm pertama.
- **Deteksi wajah** hanya jalan di browser yang mendukungnya (beberapa versi Chrome). Di browser lain, foto tetap diterima dan ditandai "wajah tidak diverifikasi".
- **Foto bukti** dienkripsi dan disimpan di browser pasien. Foto tidak dikirim ke server, jadi pengawas hanya melihat keterangan bahwa swafoto diambil.
- **Saat offline**, konfirmasi disimpan di antrean dan dikirim otomatis saat tersambung lagi. Server tetap menerimanya kalau waktu konfirmasi masih di dalam 30 menit jadwal.
- **Server di komputer lain**: alamat server diambil dari alamat halaman dengan port 3000. Untuk alamat lain, jalankan di konsol browser `localStorage.setItem('mr_api', 'http://alamat:3000/api')`.
