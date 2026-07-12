import { PrismaClient, ComplaintStatus, ComplaintPriority } from '@prisma/client';
import { eventBus } from '../events/eventBus';

const prisma = new PrismaClient();

export interface CreateComplaintInput {
  customer_id: string;
  booking_id?: string;
  job_id?: string;
  invoice_id?: string;
  subject: string;
  description: string;
  priority?: ComplaintPriority;
  created_by: string;
}

export class ComplaintService {
  /**
   * Defines allowed status transitions for a Complaint
   */
  private static readonly VALID_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
    [ComplaintStatus.Open]: [ComplaintStatus.Assigned, ComplaintStatus.Closed],
    [ComplaintStatus.Assigned]: [ComplaintStatus.InProgress, ComplaintStatus.Escalated],
    [ComplaintStatus.InProgress]: [ComplaintStatus.Resolved, ComplaintStatus.Escalated],
    [ComplaintStatus.Resolved]: [ComplaintStatus.Closed],
    [ComplaintStatus.Escalated]: [ComplaintStatus.Assigned, ComplaintStatus.InProgress],
    [ComplaintStatus.Closed]: [] // Terminal state
  };

  /**
   * Validates if a transition from `current` to `next` is allowed
   */
  private static validateTransition(current: ComplaintStatus, next: ComplaintStatus) {
    if (!this.VALID_TRANSITIONS[current].includes(next)) {
      throw new Error(`Invalid complaint status transition: ${current} → ${next}`);
    }
  }

  /**
   * Generates a new complaint ID (e.g., CMP-2607-001)
   */
  private static async generateComplaintId(): Promise<{ id: string; seq: number }> {
    const seq = await prisma.complaintSequence.upsert({
      where: { id: 1 },
      update: { value: { increment: 1 } },
      create: { id: 1, value: 1 }
    });

    const mm = new Date().getMonth() + 1;
    const yy = new Date().getFullYear().toString().substring(2);
    const monthStr = mm < 10 ? `0${mm}` : `${mm}`;
    const seqStr = seq.value.toString().padStart(3, '0');

    return {
      id: `CMP-${yy}${monthStr}-${seqStr}`,
      seq: seq.value,
    };
  }

  /**
   * Creates a new complaint and logs the timeline
   */
  public static async createComplaint(input: CreateComplaintInput) {
    const generated = await this.generateComplaintId();

    const complaint = await prisma.complaint.create({
      data: {
        complaint_id: generated.id,
        sequence_number: generated.seq,
        customer_id: input.customer_id,
        booking_id: input.booking_id,
        job_id: input.job_id,
        invoice_id: input.invoice_id,
        subject: input.subject,
        description: input.description,
        priority: input.priority || ComplaintPriority.Normal,
        created_by: input.created_by,
        status: ComplaintStatus.Open,
        timeline: {
          create: {
            to_status: ComplaintStatus.Open,
            note: 'Complaint raised by customer.',
            changed_by: input.created_by,
          },
        },
      },
    });

    // Publish event for Phase 9 Automation Engine
    eventBus.publish('Complaint.Created', {
      complaint_id: complaint.complaint_id,
      customer_id: complaint.customer_id,
      priority: complaint.priority,
    });

    return complaint;
  }

  /**
   * Assigns a complaint to a staff member
   */
  public static async assignComplaint(
    id: string,
    assigned_to: string,
    assigned_by: string,
    note?: string
  ) {
    const complaint = await prisma.complaint.findUniqueOrThrow({ where: { id } });
    this.validateTransition(complaint.status, ComplaintStatus.Assigned);

    const updated = await prisma.complaint.update({
      where: { id },
      data: {
        assigned_to,
        status: ComplaintStatus.Assigned,
        timeline: {
          create: {
            from_status: complaint.status,
            to_status: ComplaintStatus.Assigned,
            note: note || `Assigned to user ${assigned_to}`,
            changed_by: assigned_by,
          },
        },
      },
    });

    eventBus.publish('Complaint.Assigned', {
      complaint_id: updated.complaint_id,
      assigned_to: updated.assigned_to,
    });

    return updated;
  }

  /**
   * Marks a complaint as InProgress
   */
  public static async startComplaint(id: string, changed_by: string) {
    const complaint = await prisma.complaint.findUniqueOrThrow({ where: { id } });
    this.validateTransition(complaint.status, ComplaintStatus.InProgress);

    const updated = await prisma.complaint.update({
      where: { id },
      data: {
        status: ComplaintStatus.InProgress,
        timeline: {
          create: {
            from_status: complaint.status,
            to_status: ComplaintStatus.InProgress,
            note: 'Work started on complaint',
            changed_by,
          },
        },
      },
    });

    return updated;
  }

  /**
   * Resolves a complaint with a mandatory resolution note
   */
  public static async resolveComplaint(id: string, resolution_note: string, changed_by: string) {
    const complaint = await prisma.complaint.findUniqueOrThrow({ where: { id } });
    this.validateTransition(complaint.status, ComplaintStatus.Resolved);

    const updated = await prisma.complaint.update({
      where: { id },
      data: {
        status: ComplaintStatus.Resolved,
        resolution_note,
        timeline: {
          create: {
            from_status: complaint.status,
            to_status: ComplaintStatus.Resolved,
            note: resolution_note,
            changed_by,
          },
        },
      },
    });

    eventBus.publish('Complaint.Resolved', {
      complaint_id: updated.complaint_id,
      customer_id: updated.customer_id,
    });

    return updated;
  }

  /**
   * Escalates a complaint to critical priority
   */
  public static async escalateComplaint(id: string, reason: string, changed_by: string) {
    const complaint = await prisma.complaint.findUniqueOrThrow({ where: { id } });
    this.validateTransition(complaint.status, ComplaintStatus.Escalated);

    const updated = await prisma.complaint.update({
      where: { id },
      data: {
        status: ComplaintStatus.Escalated,
        priority: ComplaintPriority.Critical,
        timeline: {
          create: {
            from_status: complaint.status,
            to_status: ComplaintStatus.Escalated,
            note: `Escalated to Critical: ${reason}`,
            changed_by,
          },
        },
      },
    });

    eventBus.publish('Complaint.Escalated', {
      complaint_id: updated.complaint_id,
      priority: updated.priority,
      reason,
    });

    return updated;
  }

  /**
   * Closes a complaint
   */
  public static async closeComplaint(id: string, changed_by: string, note?: string) {
    const complaint = await prisma.complaint.findUniqueOrThrow({ where: { id } });
    this.validateTransition(complaint.status, ComplaintStatus.Closed);

    const updated = await prisma.complaint.update({
      where: { id },
      data: {
        status: ComplaintStatus.Closed,
        timeline: {
          create: {
            from_status: complaint.status,
            to_status: ComplaintStatus.Closed,
            note: note || 'Complaint closed',
            changed_by,
          },
        },
      },
    });

    return updated;
  }

  /**
   * Retrieves a complaint along with its append-only timeline
   */
  public static async getComplaintDetails(id: string) {
    return prisma.complaint.findUniqueOrThrow({
      where: { id },
      include: {
        timeline: { orderBy: { changed_at: 'asc' } },
        customer: true,
        assignedTo: true,
      },
    });
  }
}
