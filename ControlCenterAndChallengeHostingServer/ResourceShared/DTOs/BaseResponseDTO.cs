using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace ResourceShared.DTOs
{
    
    public class BaseResponseDTO
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public HttpStatusCode HttpStatusCode { get; set; }

        public BaseResponseDTO()
        {
        }

        public BaseResponseDTO(bool success, string message)
        {
            Success = success;
            Message = message;
        }

        public static BaseResponseDTO Ok(string message = "Success")
            => new BaseResponseDTO(true, message);

        public static BaseResponseDTO Fail(string message)
            => new BaseResponseDTO(false, message);
    }

    public class BaseResponseDTO<T> : BaseResponseDTO
    {
        public T? Data { get; set; }

        public BaseResponseDTO() : base()
        {
        }

        public BaseResponseDTO(bool success, string message, T? data = default)
            : base(success, message)
        {
            Data = data;
        }

        public static BaseResponseDTO<T> Ok(T data, string message = "Success")
            => new BaseResponseDTO<T>(true, message, data);
        public static BaseResponseDTO<T> Fail(string message)
           => new BaseResponseDTO<T>(false, message, default);
    }

}
