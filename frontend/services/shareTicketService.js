import { buildShareTicket } from '../sharing/ShareTicketBuilder.mjs';
import { renderShareTicket } from '../sharing/VisualTicketRenderer.mjs';

window.visualTickets = {
  build: buildShareTicket,
  generateShareTicketImage: renderShareTicket
};
