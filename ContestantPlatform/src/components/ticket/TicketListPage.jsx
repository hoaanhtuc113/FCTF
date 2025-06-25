import React, { useEffect, useState } from "react";
import { BiTime } from "react-icons/bi";
import { BsCheckCircle, BsClock, BsXCircle } from "react-icons/bs";
import {
  FaExclamationCircle,
  FaPlus,
  FaSearch,
  FaTicketAlt,
  FaTimes,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import {
  API_LIST_TICKET,
  API_TICKET_CREATE_BY_USER,
  BASE_URL,
} from "../../constants/ApiConstant";
import ApiHelper from "../../utils/ApiHelper";
import Swal from "sweetalert2";

const TicketList = () => {
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [tickets, setTickets] = useState([]);
  const navigate = useNavigate();
  const ticketTypes = ["Error", "Bug", "Issues", "Question"];

  const fetchTickets = async () => {
    try {
      const api = new ApiHelper(BASE_URL);
      const response = await api.get(API_LIST_TICKET);
      if (response && response.tickets) {
        setTickets(response.tickets);
      } else {
        throw new Error("Failed to fetch tickets");
      }
    } catch (err) {
      console.error("Error occurred:", err);
      if (err.response.status === 403) {
        setError("F-CTF has ended. Please wait until our new notification");
      } else {
        setError("Could not load tickets. Please try again.");
      }
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const handleTicketClick = (ticketId) => {
    navigate(`/ticket/${ticketId}`);
  };

  const filteredTickets = tickets.filter((ticket) => {
    const matchesSearch =
      ticket.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      filterStatus === "all" || ticket.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getStatusIcon = (status) => {
    switch (status) {
      case "open":
        return <BsClock className="text-yellow-500" />;
      case "in_progress":
        return <BiTime className="text-theme-color-primary" />;
      case "Closed":
        return <BsCheckCircle className="text-theme-color-secondary" />;
      default:
        return <BsXCircle className="text-red-500" />;
    }
  };

  const handleCreateTicket = () => {
    setShowModal(true); // Directly show the modal form
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setShowModal(false);

      const api = new ApiHelper(BASE_URL);
      const ticketData = {
        title: e.target.title.value,
        type: e.target.type.value,
        description: e.target.description.value,
      };

      const response = await api.post(API_TICKET_CREATE_BY_USER, ticketData);

      if (response.status === true) {
        // Success: Add the new ticket to the list
        setError(""); // Clear any previous errors
        Swal.fire({
          title: "Success",
          text: "Ticket sent successfully!",
          icon: "success",
          confirmButtonText: "OK",
          customClass: {
            confirmButton:
              "rounded-md bg-theme-color-primary px-4 py-2 text-white transition-all hover:bg-theme-color-primary-dark focus:outline-none focus:ring-2 focus:ring-theme-color-primary focus:ring-offset-2",
          },
        });
        fetchTickets();
      } else {
        // Handle different error cases
        const message =
          response.message ||
          response.error ||
          "Failed to send the ticket. Please try again.";
        setError(message);
      }
    } catch (err) {
      console.error("Error occurred:", err);
      setError(
        err.response.data.message ||
          "Failed to send the ticket. Please try again."
      );
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 bg-gray-900 transition-colors duration-300">
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-red-900 p-4 text-red-300 shadow-lg">
          <FaExclamationCircle />
          <span>{error}</span>
          <button
            onClick={() => setError("")}
            className="ml-auto hover:text-orange-400 transition-colors"
            aria-label="Close error message"
          >
            <FaTimes />
          </button>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-orange-400 drop-shadow-lg">
          Support Tickets
        </h1>
        <button
          onClick={handleCreateTicket}
          className="flex items-center gap-2 rounded-md bg-orange-400 px-4 py-2 text-white shadow-lg transition-all hover:bg-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-gray-900"
          aria-label="Create new ticket"
        >
          <FaPlus />
          <span>Create New Ticket</span>
        </button>
      </div>

      <div className="mb-6 rounded-lg bg-gray-800 p-4 shadow-md">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <FaSearch className="text-gray-500" />
            </div>
            <input
              type="text"
              placeholder="Search tickets by ID or title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border  bg-gray-900 pl-10 pr-4 py-2 text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 transition-colors"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-200">
              Status:
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-md border  bg-gray-900 py-2 px-4 text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 transition-colors"
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg bg-gray-800 shadow-md">
        <table className="min-w-full">
          <thead className="bg-gray-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold text-orange-300 uppercase">
                ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold text-orange-300 uppercase">
                Title
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold text-orange-300 uppercase">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold text-orange-300 uppercase">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold text-orange-300 uppercase">
                Created
              </th>
              <th className="px-4 py-3 text-left text-xs font-bold text-orange-300 uppercase">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredTickets.map((ticket) => (
              <tr
                key={ticket.id}
                className="hover:bg-gray-700 transition cursor-pointer"
                onClick={() => handleTicketClick(ticket.id)}
              >
                <td className="px-4 py-3 font-medium text-gray-200">
                  {ticket.id}
                </td>
                <td className="px-4 py-3 font-semibold text-white">
                  {ticket.title}
                </td>
                <td className="px-4 py-3 text-gray-200 capitalize">
                  {ticket.type}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2">
                    {getStatusIcon(ticket.status)}
                    <span className="capitalize text-gray-200">
                      {ticket.status.replace("_", " ")}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-300">
                  {ticket.date}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTicketClick(ticket.id);
                    }}
                    className="px-3 py-1 rounded bg-orange-400 text-white hover:bg-orange-500 transition text-xs font-semibold shadow focus:outline-none focus:ring-2 focus:ring-orange-400"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-full max-w-md rounded-2xl bg-gray-900 p-6 shadow-2xl border border-orange-400 animate-fade-in">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-orange-400">
                Create New Ticket
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-300 hover:text-orange-400 transition-colors"
                aria-label="Close modal"
              >
                <FaTimes />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label
                  htmlFor="title"
                  className="mb-2 block text-sm font-medium text-gray-200"
                >
                  Title
                </label>
                <input
                  type="text"
                  id="title"
                  name="title"
                  className="w-full rounded-md border border-gray-700 bg-gray-800 p-2 text-white focus:border-[#e45c25] focus:outline-none focus:ring-1 focus:ring-[#e45c25]"
                  required
                />
              </div>
              <div className="mb-4">
                <label
                  htmlFor="type"
                  className="mb-2 block text-sm font-medium text-gray-200"
                >
                  Type
                </label>
                <select
                  id="type"
                  name="type"
                  className="w-full rounded-md border border-gray-700 bg-gray-800 p-2 text-white focus:border-[#e45c25] focus:outline-none focus:ring-1 focus:ring-[#e45c25]"
                  required
                >
                  {ticketTypes.map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-6">
                <label
                  htmlFor="description"
                  className="mb-2 block text-sm font-medium text-gray-200"
                >
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  className="w-full rounded-md border border-gray-700 bg-gray-800 p-2 text-white focus:border-[#e45c25] focus:outline-none focus:ring-1 focus:ring-[#e45c25]"
                  rows="3"
                  required
                ></textarea>
              </div>
              <button
                type="submit"
                className="w-full rounded-md bg-orange-400 px-4 py-2 text-white shadow-lg border border-orange-400 transition-all hover:bg-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                Submit
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TicketList;
