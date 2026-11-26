namespace MedReminder.Api.Abstractions;

// INTERFACE: kontrak untuk entitas yang memiliki jadwal minum obat
public interface ISchedulable
{
    DateTime ScheduledAtUtc { get; }
    bool IsDue(DateTime nowUtc);
}

// INTERFACE: kontrak untuk layanan notifikasi/pengingat
public interface IReminderNotifier
{
    string SendReminder(string recipientName, string message);
}

// ABSTRACT CLASS: kelas abstrak dasar untuk catatan dosis
public abstract class BaseDoseRecord
{
    public int Id { get; set; }
    public int PatientId { get; set; }
    public int MedicationId { get; set; }
    public DateTime ScheduledAtUtc { get; protected set; }
    public string Status { get; protected set; } = "terjadwal";

    protected const int WindowMinutes = 30;

    protected BaseDoseRecord(int id, int patientId, int medicationId, DateTime scheduledAtUtc)
    {
        Id = id;
        PatientId = patientId;
        MedicationId = medicationId;
        ScheduledAtUtc = scheduledAtUtc;
    }

    // Concrete method yang diwariskan ke semua turunan
    public bool IsOverdue(DateTime nowUtc)
    {
        return Status == "terjadwal" && nowUtc > ScheduledAtUtc.AddMinutes(WindowMinutes);
    }

    // Abstract method: wajib diimplementasikan oleh kelas turunan
    public abstract bool Confirm(DateTime deviceTimeUtc, string poseChallenge);
}
