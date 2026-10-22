using ElectroApi.Core.Entities;

namespace ElectroApi.Core.Interfaces;

public interface ICommerceMail
{
    EmailOutbox Create(string to, string subject, string body);
    string Link(string path, IReadOnlyDictionary<string, string> fragment);
}
