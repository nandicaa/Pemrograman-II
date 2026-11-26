using MedReminder.Api.Abstractions;
using MedReminder.Api.Models;

namespace MedReminder.Api.Services;

// 4. GENERIC, COLLECTION, DAN DICTIONARY
public interface IRepository<T> where T : class
{
    void Add(int id, T item);
    T? GetById(int id);
    IReadOnlyCollection<T> GetAll();
    bool Remove(int id);
}

// Generic Repository menggunakan Dictionary<int, T> dan Collection (List<T>)
public class InMemoryRepository<T> : IRepository<T> where T : class
{
    private readonly Dictionary<int, T> _storage = new();

    public void Add(int id, T item) => _storage[id] = item;

    public T? GetById(int id) => _storage.TryGetValue(id, out var item) ? item : null;

    public IReadOnlyCollection<T> GetAll() => _storage.Values.ToList();

    public bool Remove(int id) => _storage.Remove(id);
}

// Service menggunakan Collection (List<DoseRecord>), Dictionary<string, List<DoseRecord>>, dan Interface
public class MedicationScheduleService : IReminderNotifier
{
    private readonly IRepository<Medication> _medRepo;
    private readonly List<DoseRecord> _doses = new();

    public MedicationScheduleService(IRepository<Medication> medRepo)
    {
        _medRepo = medRepo;
    }

    public List<DoseRecord> GenerateDailySchedule(Medication med, DateTime startDateUtc)
    {
        var created = new List<DoseRecord>();
        double stepHours = 24.0 / med.TimesPerDay;
        int nextId = _doses.Count + 1;

        for (int i = 0; i < med.TimesPerDay; i++)
        {
            var dose = new DoseRecord(nextId++, med.PatientId, med.Id, startDateUtc.AddHours(i * stepHours));
            _doses.Add(dose);
            created.Add(dose);
        }
        return created;
    }

    // Dictionary: mengelompokkan daftar dosis berdasarkan tanggal (YYYY-MM-DD)
    public Dictionary<string, List<DoseRecord>> GroupDosesByDate(int patientId)
    {
        var grouped = new Dictionary<string, List<DoseRecord>>();
        foreach (var dose in _doses.Where(d => d.PatientId == patientId))
        {
            string key = dose.ScheduledAtUtc.ToString("yyyy-MM-dd");
            if (!grouped.ContainsKey(key))
                grouped[key] = new List<DoseRecord>();
            grouped[key].Add(dose);
        }
        return grouped;
    }

    public IReadOnlyCollection<Medication> GetAllMedications() => _medRepo.GetAll();

    public string SendReminder(string recipientName, string message)
    {
        return $"[Alarm untuk {recipientName}] {message}";
    }
}
