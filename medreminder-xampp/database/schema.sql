-- MedReminder: skema database untuk MySQL 8 / MariaDB 10.4+ (XAMPP)
--
-- PERHATIAN: berkas ini MENGHAPUS tabel lama lalu membuatnya ulang.
-- Semua data MedReminder yang sudah ada akan hilang.
--
-- Cara pakai: phpMyAdmin -> tab Import -> pilih berkas ini -> Import.
-- Semua kolom DATETIME disimpan dalam UTC.

CREATE DATABASE IF NOT EXISTS medreminder
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE medreminder;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS doses;
DROP TABLE IF EXISTS supervisor_links;
DROP TABLE IF EXISTS medications;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

-- Akun pasien dan pengawas. Satu email boleh punya satu akun pasien dan satu akun pengawas.
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,                     -- bcrypt, bukan password asli
  role          ENUM('pasien','pengawas') NOT NULL,
  timezone      VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta', -- zona waktu pasien, untuk menghitung jam minum
  consent_at    DATETIME NULL,                             -- kapan pasien menyetujui penggunaan data
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email_role (email, role)
) ENGINE=InnoDB;

-- Obat milik pasien. Jadwal dosis dibuat server dari aturan minum (mis. 3x1) dan jam minum pertama.
CREATE TABLE medications (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id     INT UNSIGNED NOT NULL,
  name           VARCHAR(120) NOT NULL,
  type           ENUM('botol','pil','lain') NOT NULL DEFAULT 'pil',  -- untuk fitur analisis foto (rencana)
  unit           VARCHAR(80)  NOT NULL,                    -- mis. "tablet 500 mg"
  note           VARCHAR(255) NULL,                        -- mis. "sesudah makan"
  times_per_day  TINYINT UNSIGNED NOT NULL,                -- angka pertama di 3x1
  qty_per_dose   DECIMAL(5,2) NOT NULL DEFAULT 1,          -- angka kedua di 3x1
  first_time     CHAR(5) NOT NULL,                         -- jam minum pertama, waktu lokal pasien "06:00"
  schedule_times VARCHAR(60) NOT NULL,                     -- hasil hitung, mis. "06:00,14:00,22:00"
  duration_days  SMALLINT UNSIGNED NOT NULL,
  start_date     DATE NOT NULL,
  stock          DECIMAL(7,2) NOT NULL DEFAULT 0,
  min_stock      DECIMAL(7,2) NOT NULL DEFAULT 0,
  active         TINYINT(1) NOT NULL DEFAULT 1,            -- 0 = dihapus pasien; riwayat dosis tetap ada
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_med_patient (patient_id, active),
  CONSTRAINT fk_med_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Setiap dosis terjadwal. Dibuat server saat obat ditambahkan atau diubah.
--   terjadwal : belum waktunya, atau sedang dalam 30 menit jendela minum
--   diminum   : dikonfirmasi dengan swafoto
--   dilewati  : pasien menekan "Tidak bisa foto"
--   terlewat  : 30 menit lewat tanpa konfirmasi (ditandai server setiap menit)
-- Foto bukti TIDAK disimpan di sini; foto tetap terenkripsi di perangkat pasien.
CREATE TABLE doses (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id    INT UNSIGNED NOT NULL,
  medication_id INT UNSIGNED NOT NULL,
  scheduled_at  DATETIME NOT NULL,
  status        ENUM('terjadwal','diminum','dilewati','terlewat') NOT NULL DEFAULT 'terjadwal',
  device_time   DATETIME NULL,                             -- waktu konfirmasi menurut jam perangkat
  server_time   DATETIME NULL,                             -- stempel waktu server saat status berubah
  warning       VARCHAR(255) NULL,                         -- diisi bila jam perangkat selisih > 5 menit
  pose          VARCHAR(80) NULL,                          -- tantangan pose yang diberikan saat swafoto
  face_check    ENUM('ok','tidak_diverifikasi') NULL,      -- hasil pemeriksaan wajah di perangkat
  UNIQUE KEY uq_dose_med_time (medication_id, scheduled_at),
  KEY idx_dose_patient_sched (patient_id, scheduled_at),
  KEY idx_dose_status_sched (status, scheduled_at),
  CONSTRAINT fk_dose_patient FOREIGN KEY (patient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_dose_med     FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Pasien menautkan pengawas lewat email. Pengawas hanya bisa melihat pasien yang menautkannya.
CREATE TABLE supervisor_links (
  patient_id    INT UNSIGNED NOT NULL,
  supervisor_id INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (patient_id, supervisor_id),
  KEY idx_link_supervisor (supervisor_id),
  CONSTRAINT fk_link_patient    FOREIGN KEY (patient_id)    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_link_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
