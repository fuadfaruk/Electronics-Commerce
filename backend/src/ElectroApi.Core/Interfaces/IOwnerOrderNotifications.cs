using ElectroApi.Core.Entities;

namespace ElectroApi.Core.Interfaces;

public interface IOwnerOrderNotifications
{
    OwnerOrderNotification? Create(Order order);
}
