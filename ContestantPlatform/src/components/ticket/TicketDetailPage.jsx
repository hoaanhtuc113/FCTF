import React, { useEffect, useState } from "react";
import { FaArrowLeft, FaCalendarAlt, FaInfoCircle, FaReply, FaUser } from "react-icons/fa";
import { useNavigate, useParams } from "react-router-dom";
import { API_DETAIL_TICKET, BASE_URL } from "../../constants/ApiConstant";
import ApiHelper from "../../utils/ApiHelper";

const TicketDetailPage = () => {
  const { id }= useParams()
  console.log(`Id get from url is: ${id}`)
  const ticketId = id? parseInt(id,10): undefined
  const [ticket, setTicket]= useState(null)
  const [error, setError]= useState(null)
  const navigate = useNavigate()

  useEffect(()=> {
    const fetchTicketDetail= async()=> {
      const api= new ApiHelper(BASE_URL);
      try {
        const response= await api.get(`${API_DETAIL_TICKET}/${ticketId}`)
        setTicket(response)
      } catch (err) {
        console.error(`Error fetching challenge: ${err}` )
        setError("Could not load ticket. Try Again!")
      }
    };
    fetchTicketDetail()
  }, [ticketId])
  
  return (
    <div className="min-h-screen p-4 md:p-8 bg-gray-900 transition-colors duration-300">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate('/tickets')}
          className="mb-4 flex items-center gap-2 px-4 py-2 rounded-md bg-orange-400 text-white hover:bg-orange-500 transition font-semibold shadow focus:outline-none focus:ring-2 focus:ring-orange-400"
        >
          <FaArrowLeft />
          Back to List
        </button>
        <div className="bg-gray-800 rounded-2xl shadow-2xl overflow-hidden border :border-orange-400 transition-colors">
          {/* Header Section */}
          <div className="bg-orange-400 p-6 transition-colors">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
              <h1 className="text-2xl font-bold text-white mb-2 md:mb-0 drop-shadow">Ticket Details</h1>
              <div className="flex items-center space-x-4">
                <span
                  className={`px-4 py-1 rounded-full font-semibold shadow transition-colors duration-200
                    ${ticket?.status?.toLowerCase() === "open"
                      ? "bg-green-500 text-white"
                      : ticket?.status?.toLowerCase() === "in_progress"
                      ? "bg-yellow-400 text-white"
                      : "bg-red-500 text-white"}
                  `}
                >
                  {ticket?.status}
                </span>
              </div>
            </div>
          </div>

          {/* Ticket Information */}
          <div className="p-6 bg-gray-800 transition-colors">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <FaUser className="text-orange-400 text-xl" />
                  <div>
                    <p className="text-sm text-gray-300">Author</p>
                    <p className="font-medium text-white">{ticket?.author_name}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <FaCalendarAlt className="text-orange-400 text-xl" />
                  <div>
                    <p className="text-sm text-gray-300">Creation Date</p>
                    <p className="font-medium text-white">{ticket?.date}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <FaReply className="text-orange-400 text-xl" />
                  <div>
                    <p className="text-sm text-gray-300">Replier</p>
                    <p className="font-medium text-white">{ticket?.replier_name}</p>
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold mb-2 text-white">Title</h2>
                  <p className="text-gray-200 bg-gray-900 p-3 rounded-md shadow-sm transition-colors">{ticket?.title}</p>
                </div>

                <div>
                  <h2 className="text-xl font-semibold mb-2 text-white">Description</h2>
                  <p className="text-gray-200 bg-gray-900 p-3 rounded-md min-h-[100px] shadow-sm transition-colors">{ticket?.description}</p>
                </div>

                <div>
                  <h2 className="text-xl font-semibold mb-2 text-white">Reply from {ticket?.replier_name}</h2>
                  <p className="text-gray-200 bg-gray-900 p-3 rounded-md min-h-[100px] shadow-sm transition-colors">{ticket?.replier_message}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Additional Information */}
          <div className="border-t border-orange-400 p-6 bg-gray-900 transition-colors">
            <div className="flex items-center space-x-2 text-sm text-gray-300">
              <FaInfoCircle className="text-orange-400" />
              <p>Last updated: 2 hours ago</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TicketDetailPage;