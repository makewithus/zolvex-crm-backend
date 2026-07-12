import { Request, Response } from 'express';
import { ComplaintService } from '../services/complaint.service';
import { PrismaClient } from '@prisma/client';
import { createComplaintSchema, assignComplaintSchema, resolveComplaintSchema, escalateComplaintSchema, closeComplaintSchema } from '../validations/complaint.validation';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export class ComplaintController {
  
  static async createComplaint(req: any, res: Response) {
    try {
      const { error, value } = createComplaintSchema.validate(req.body);
      if (error) return res.status(400).json({ error: error.details[0].message });

      // User creating the complaint is extracted from auth context
      const created_by = req.user!.id;

      const complaint = await ComplaintService.createComplaint({
        ...value,
        created_by
      });

      return res.status(201).json(complaint);
    } catch (error: any) {
      logger.error('Error creating complaint:', error);
      return res.status(500).json({ error: 'Failed to create complaint' });
    }
  }

  static async getComplaints(req: any, res: Response) {
    try {
      // Basic filtering support
      const { status, city_id } = req.query;
      const user = req.user!;
      
      let whereClause: any = {};
      
      if (status) whereClause.status = status;
      
      // RBAC filtering
      if (user.role === 'City Manager') {
        whereClause.customer = {
          bookings: { some: { city_id: user.cityId } }
        };
      } else if (user.role === 'Technician' || user.role === 'Support Agent') {
        whereClause.assigned_to = user.id;
      }

      // If city_id is explicitly passed and user is Super Admin, allow filtering
      if (city_id && user.role === 'Super Admin') {
        whereClause.customer = {
          bookings: { some: { city_id: city_id as string } }
        };
      }

      const complaints = await prisma.complaint.findMany({
        where: whereClause,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          assignedTo: { select: { id: true, name: true } },
        },
        orderBy: { created_at: 'desc' }
      });

      return res.json(complaints);
    } catch (error: any) {
      logger.error('Error fetching complaints:', error);
      return res.status(500).json({ error: 'Failed to fetch complaints' });
    }
  }

  static async getComplaintById(req: any, res: Response) {
    try {
      const { id } = req.params;
      const complaint = await ComplaintService.getComplaintDetails(id);
      
      // RBAC check
      const user = req.user!;
      if (user.role === 'City Manager') {
         // Fetch if this customer has any bookings in the CM's city
         const hasBookingInCity = await prisma.booking.findFirst({
           where: { customer_id: complaint.customer_id, city_id: user.cityId! }
         });
         const hasLeadInCity = await prisma.lead.findFirst({
           where: { customer_id: complaint.customer_id, city_id: user.cityId! }
         });
         
         if (!hasBookingInCity && !hasLeadInCity) {
             return res.status(403).json({ error: 'Forbidden: Out of city' });
         }
      } else if (user.role === 'Technician' || user.role === 'Support Agent') {
         if (complaint.assigned_to !== user.id) {
             return res.status(403).json({ error: 'Forbidden: Not assigned to you' });
         }
      }

      return res.json(complaint);
    } catch (error: any) {
      if (error.code === 'P2025' || error.name === 'NotFoundError') {
        return res.status(404).json({ error: 'Complaint not found' });
      }
      logger.error('Error fetching complaint:', error);
      return res.status(500).json({ error: 'Failed to fetch complaint' });
    }
  }

  static async assignComplaint(req: any, res: Response) {
    try {
      const { error, value } = assignComplaintSchema.validate(req.body);
      if (error) return res.status(400).json({ error: error.details[0].message });

      const complaint = await ComplaintService.assignComplaint(
        req.params.id,
        value.assigned_to,
        req.user!.id,
        value.note
      );

      return res.json(complaint);
    } catch (error: any) {
      if (error.message.includes('Invalid complaint status transition')) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('Error assigning complaint:', error);
      return res.status(500).json({ error: 'Failed to assign complaint' });
    }
  }

  static async startComplaint(req: any, res: Response) {
    try {
      const complaint = await ComplaintService.startComplaint(req.params.id, req.user!.id);
      return res.json(complaint);
    } catch (error: any) {
      if (error.message.includes('Invalid complaint status transition')) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('Error starting complaint:', error);
      return res.status(500).json({ error: 'Failed to start complaint' });
    }
  }

  static async resolveComplaint(req: any, res: Response) {
    try {
      const { error, value } = resolveComplaintSchema.validate(req.body);
      if (error) return res.status(400).json({ error: error.details[0].message });

      const complaint = await ComplaintService.resolveComplaint(
        req.params.id,
        value.resolution_note,
        req.user!.id
      );

      return res.json(complaint);
    } catch (error: any) {
      if (error.message.includes('Invalid complaint status transition')) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('Error resolving complaint:', error);
      return res.status(500).json({ error: 'Failed to resolve complaint' });
    }
  }

  static async escalateComplaint(req: any, res: Response) {
    try {
      const { error, value } = escalateComplaintSchema.validate(req.body);
      if (error) return res.status(400).json({ error: error.details[0].message });

      const complaint = await ComplaintService.escalateComplaint(
        req.params.id,
        value.reason,
        req.user!.id
      );

      return res.json(complaint);
    } catch (error: any) {
      if (error.message.includes('Invalid complaint status transition')) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('Error escalating complaint:', error);
      return res.status(500).json({ error: 'Failed to escalate complaint' });
    }
  }

  static async closeComplaint(req: any, res: Response) {
    try {
      const { error, value } = closeComplaintSchema.validate(req.body);
      if (error) return res.status(400).json({ error: error.details[0].message });

      const complaint = await ComplaintService.closeComplaint(
        req.params.id,
        req.user!.id,
        value.note
      );

      return res.json(complaint);
    } catch (error: any) {
      if (error.message.includes('Invalid complaint status transition')) {
        return res.status(400).json({ error: error.message });
      }
      logger.error('Error closing complaint:', error);
      return res.status(500).json({ error: 'Failed to close complaint' });
    }
  }
}
