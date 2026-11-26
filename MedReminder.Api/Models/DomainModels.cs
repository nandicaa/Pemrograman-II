using MedReminder.Api.Abstractions;

namespace MedReminder.Api.Models;

// 1. VARIABLE, GET/SET PROPERTY, DAN METHOD
public class Medication
{
    // Private variables (fields)
    private double _stock;
    private double _minStock;
    private int _timesPerDay;
    private double _qtyPerDose;

    // Properties (get / set)
    public int Id { get; set; }
    public int PatientId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Unit { get; set; } = "tablet";
    public string FirstTime { get; set; } = "06:00";
    public int DurationDays { get; set; } = 7;

    public int TimesPerDay
    {
        get => _timesPerDay;
        set
        {
            if (value < 1 || value > 6)
                throw new ArgumentOutOfRangeException(nameof(TimesPerDay), "Maksimal 6 kali sehari.");
            _timesPerDay = value;
        }
    }

    public double QtyPerDose
    {
        get => _qtyPerDose;
        set
        {
            if (value <= 0 || value > 20)
                throw new ArgumentOutOfRangeException(nameof(QtyPerDose), "Jumlah tiap minum harus > 0.");
            _qtyPerDose = value;
        }
    }

    public double Stock
    {
        get => _stock;
        set => _stock = Math.Clamp(value, 0, 99999);
    }

    public double MinStock
    {
        get => _minStock;
        set => _minStock = Math.Clamp(value, 0, 99999);
    }

    // Methods
    public double GetDailyUsage() => TimesPerDay * QtyPerDose;

    public bool IsLowStock() => Stock <= MinStock;

    public int GetEstimatedDaysLeft()
    {
        double perDay = GetDailyUsage();
        return perDay > 0 ? (int)Math.Floor(Stock / perDay) : 0;
    }

    public void ConsumeDose()
    {
        Stock = Math.Max(0, Stock - QtyPerDose);
    }

    public void Refill(double amount)
    {
        if (amount <= 0)
            throw new ArgumentException("Jumlah isi ulang harus lebih dari 0.", nameof(amount));
        Stock += amount;
    }
}

// 2. INHERITANCE (Base class -> Patient & Supervisor)
public class User
{
    public int Id { get; set; }
    public string Name { get; set; }
    public string Email { get; set; }
    public string Role { get; protected set; }

    public User(int id, string name, string email, string role)
    {
        Id = id;
        Name = name;
        Email = email;
        Role = role;
    }

    public virtual string GetProfileSummary()
    {
        return $"{Name} ({Email}) - Peran: {Role}";
    }
}

public class Patient : User
{
    public string Timezone { get; set; }
    public bool HasConsented { get; set; }

    public Patient(int id, string name, string email, string timezone, bool hasConsented)
        : base(id, name, email, "pasien")
    {
        Timezone = timezone;
        HasConsented = hasConsented;
    }

    public override string GetProfileSummary()
    {
        return $"[Pasien] {Name} ({Email}) - Zona waktu: {Timezone}";
    }
}

public class Supervisor : User
{
    public List<int> LinkedPatientIds { get; } = new();

    public Supervisor(int id, string name, string email)
        : base(id, name, email, "pengawas")
    {
    }

    public void LinkPatient(int patientId)
    {
        if (!LinkedPatientIds.Contains(patientId))
            LinkedPatientIds.Add(patientId);
    }

    public override string GetProfileSummary()
    {
        return $"[Pengawas] {Name} ({Email}) - Memantau {LinkedPatientIds.Count} pasien";
    }
}

// Implementasi Abstract Class + Interface
public class DoseRecord : BaseDoseRecord, ISchedulable
{
    public string? PoseChallenge { get; private set; }
    public DateTime? ConfirmedAtUtc { get; private set; }

    public DoseRecord(int id, int patientId, int medicationId, DateTime scheduledAtUtc)
        : base(id, patientId, medicationId, scheduledAtUtc)
    {
    }

    public bool IsDue(DateTime nowUtc)
    {
        return Status == "terjadwal"
            && nowUtc >= ScheduledAtUtc
            && nowUtc <= ScheduledAtUtc.AddMinutes(WindowMinutes);
    }

    public override bool Confirm(DateTime deviceTimeUtc, string poseChallenge)
    {
        if (string.IsNullOrWhiteSpace(poseChallenge) || IsOverdue(deviceTimeUtc))
            return false;

        Status = "diminum";
        PoseChallenge = poseChallenge.Trim();
        ConfirmedAtUtc = deviceTimeUtc;
        return true;
    }
}
