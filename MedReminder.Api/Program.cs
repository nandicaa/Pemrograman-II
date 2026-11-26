using MedReminder.Api.Models;
using MedReminder.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<IRepository<Medication>, InMemoryRepository<Medication>>();
builder.Services.AddSingleton<MedicationScheduleService>();

var app = builder.Build();

// Seed contoh data awal
var medRepo = app.Services.GetRequiredService<IRepository<Medication>>();
var scheduleService = app.Services.GetRequiredService<MedicationScheduleService>();

var sampleMed = new Medication
{
    Id = 1,
    PatientId = 1,
    Name = "Amoksisilin",
    Unit = "tablet 500 mg",
    TimesPerDay = 3,
    QtyPerDose = 1,
    Stock = 30,
    MinStock = 5
};
medRepo.Add(sampleMed.Id, sampleMed);
scheduleService.GenerateDailySchedule(sampleMed, DateTime.UtcNow.Date.AddHours(6));

app.MapGet("/api/health", () => Results.Ok(new { ok = true, framework = "ASP.NET Core", serverTime = DateTime.UtcNow }));
app.MapGet("/api/medications", () => Results.Ok(scheduleService.GetAllMedications()));
app.MapGet("/api/doses/grouped/{patientId:int}", (int patientId) => Results.Ok(scheduleService.GroupDosesByDate(patientId)));

app.Run();
