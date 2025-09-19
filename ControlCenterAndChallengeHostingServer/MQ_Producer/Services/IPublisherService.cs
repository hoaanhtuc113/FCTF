namespace MQ_Producer.Services
{
    public interface IPublisherService<T>
    {
        Task PublishMessage(T message);
    }
}
