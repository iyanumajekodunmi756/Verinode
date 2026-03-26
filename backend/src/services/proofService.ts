import { Proof, IProof } from '../models/Proof';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { eventService } from './events/EventService';
import { 
  ProofCreatedEvent, 
  ProofVerifiedEvent, 
  ProofUpdatedEvent, 
  ProofDeletedEvent 
} from '../events/EventTypes';
import { EventUtils } from '../utils/eventUtils';

/**
 * Proof Service - Handles all proof business logic
 */
export class ProofService extends EventEmitter {
  private static instance: ProofService;

  private constructor() {
    super();
  }

  static getInstance(): ProofService {
    if (!ProofService.instance) {
      ProofService.instance = new ProofService();
    }
    return ProofService.instance;
  }

  /**
   * Create a new proof
   */
  async createProof(data: {
    title: string;
    description: string;
    proofType: string;
    metadata: Record<string, any>;
    eventData: Record<string, any>;
    recipientAddress?: string;
    tags: string[];
    createdBy: string;
  }): Promise<IProof> {
    try {
      // Generate unique proof ID
      const proofId = this.generateProofId();
      
      // Create hash for integrity verification
      const hash = this.generateProofHash({
        title: data.title,
        description: data.description,
        proofType: data.proofType,
        metadata: data.metadata,
        eventData: data.eventData,
        recipientAddress: data.recipientAddress,
        tags: data.tags
      });

      const proof = new Proof({
        id: proofId,
        title: data.title,
        description: data.description,
        proofType: data.proofType,
        metadata: data.metadata,
        eventData: data.eventData,
        recipientAddress: data.recipientAddress,
        tags: data.tags,
        hash,
        status: 'draft',
        createdBy: data.createdBy,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await proof.save();

      // Emit PROOF_CREATED event using the new event system
      try {
        const proofCreatedEvent = await eventService.createEvent<ProofCreatedEvent>(
          'PROOF_CREATED',
          {
            proofId: proof.id,
            proofType: proof.proofType,
            creator: proof.createdBy,
            commitment: proof.hash,
            verificationKey: proof.hash, // Using hash as verification key for now
            publicInputs: proof.eventData ? Object.values(proof.eventData) : [],
            metadata: {
              description: proof.description,
              title: proof.title,
              tags: proof.tags
            }
          },
          {
            source: 'proof-service',
            correlationId: EventUtils.generateCorrelationId(),
            metadata: {
              operation: 'create',
              timestamp: new Date(),
              recipientAddress: proof.recipientAddress
            }
          }
        );
        
        await eventService.publishEvent(proofCreatedEvent, `proof:${proof.id}`);
      } catch (eventError) {
        logger.warn('Failed to publish PROOF_CREATED event:', eventError);
      }

      // Keep the legacy event emitter for backward compatibility
      this.emit('proofCreated', proof);

      logger.info(`Proof created: ${proofId}`);
      return proof.toObject();

    } catch (error) {
      logger.error('Error creating proof:', error);
      throw new Error('Failed to create proof');
    }
  }

  /**
   * Verify a proof
   */
  async verifyProof(proofId: string, verificationData: {
    verifiedBy: string;
    verificationMethod: string;
    additionalData: Record<string, any>;
  }): Promise<{
    proof: IProof;
    verificationResult: {
      isValid: boolean;
      verifiedAt: Date;
      verifiedBy: string;
      method: string;
      details: Record<string, any>;
    };
  }> {
    try {
      const proof = await Proof.findOne({ id: proofId });
      
      if (!proof) {
        throw new Error('Proof not found');
      }

      // Check if proof is already verified
      if (proof.status === 'verified') {
        throw new Error('Proof is already verified');
      }

      // Verify hash integrity
      const currentHash = proof.hash;
      const expectedHash = this.generateProofHash({
        title: proof.title,
        description: proof.description,
        proofType: proof.proofType,
        metadata: proof.metadata,
        eventData: proof.eventData,
        recipientAddress: proof.recipientAddress,
        tags: proof.tags
      });

      const isValid = currentHash === expectedHash;

      // Update proof status
      proof.status = isValid ? 'verified' : 'verification_failed';
      proof.verifiedAt = new Date();
      proof.verifiedBy = verificationData.verifiedBy;
      proof.updatedAt = new Date();

      // Add verification to history
      proof.verificationHistory = proof.verificationHistory || [];
      proof.verificationHistory.push({
        verifiedAt: new Date(),
        verifiedBy: verificationData.verifiedBy,
        method: verificationData.verificationMethod,
        result: isValid,
        details: verificationData.additionalData
      });

      await proof.save();

      const verificationResult = {
        isValid,
        verifiedAt: proof.verifiedAt!,
        verifiedBy: verificationData.verifiedBy,
        method: verificationData.verificationMethod,
        details: verificationData.additionalData
      };

      // Emit PROOF_VERIFIED event using the new event system
      try {
        const proofVerifiedEvent = await eventService.createEvent<ProofVerifiedEvent>(
          'PROOF_VERIFIED',
          {
            proofId: proof.id,
            verified: isValid,
            verificationTime: proof.verifiedAt!.getTime() - proof.createdAt.getTime(),
            verificationAttempts: proof.verificationHistory?.length || 1,
            error: isValid ? undefined : 'Verification failed',
            verifiedBy: verificationData.verifiedBy
          },
          {
            source: 'proof-service',
            correlationId: EventUtils.generateCorrelationId(),
            metadata: {
              operation: 'verify',
              timestamp: new Date(),
              verificationMethod: verificationData.verificationMethod
            }
          }
        );
        
        await eventService.publishEvent(proofVerifiedEvent, `proof:${proof.id}`);
      } catch (eventError) {
        logger.warn('Failed to publish PROOF_VERIFIED event:', eventError);
      }

      // Keep the legacy event emitter for backward compatibility
      this.emit('proofVerified', { proof: proof.toObject(), verificationResult });

      logger.info(`Proof verification completed: ${proofId}, valid: ${isValid}`);
      
      return {
        proof: proof.toObject(),
        verificationResult
      };

    } catch (error) {
      logger.error('Error verifying proof:', error);
      throw error;
    }
  }

  /**
   * Get user's proofs with filtering and pagination
   */
  async getUserProofs(
    userId: string,
    filters: {
      status?: string;
      proofType?: string;
      search?: string;
    },
    pagination: {
      page: number;
      limit: number;
    },
    sorting: {
      sortBy: string;
      sortOrder: 'asc' | 'desc';
    }
  ): Promise<{
    proofs: IProof[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    try {
      const query: any = { createdBy: userId };

      // Apply filters
      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.proofType) {
        query.proofType = filters.proofType;
      }

      if (filters.search) {
        query.$or = [
          { title: { $regex: filters.search, $options: 'i' } },
          { description: { $regex: filters.search, $options: 'i' } },
          { tags: { $in: [new RegExp(filters.search, 'i')] } }
        ];
      }

      // Apply sorting
      const sort: any = {};
      sort[sorting.sortBy] = sorting.sortOrder === 'desc' ? -1 : 1;

      // Get total count
      const total = await Proof.countDocuments(query);

      // Get paginated results
      const proofs = await Proof.find(query)
        .sort(sort)
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .lean();

      return {
        proofs,
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit)
      };

    } catch (error) {
      logger.error('Error getting user proofs:', error);
      throw error;
    }
  }

  /**
   * Get proof by ID with access control
   */
  async getProofById(proofId: string, userId?: string): Promise<IProof | null> {
    try {
      const query: any = { id: proofId };

      // If userId is provided, check access
      if (userId) {
        query.$or = [
          { createdBy: userId },
          { recipientAddress: userId },
          { 'sharedWith.userId': userId }
        ];
      }

      const proof = await Proof.findOne(query).lean();

      if (!proof) {
        return null;
      }

      return proof;

    } catch (error) {
      logger.error('Error getting proof by ID:', error);
      throw error;
    }
  }

  /**
   * Update proof
   */
  async updateProof(proofId: string, userId: string, updateData: Partial<IProof>): Promise<IProof | null> {
    try {
      const proof = await Proof.findOne({ id: proofId, createdBy: userId });

      if (!proof) {
        return null;
      }

      // Don't allow updating certain fields
      const allowedUpdates = ['title', 'description', 'metadata', 'eventData', 'recipientAddress', 'tags'];
      const updates: any = {};

      for (const key of allowedUpdates) {
        if (updateData[key as keyof IProof] !== undefined) {
          updates[key] = updateData[key as keyof IProof];
        }
      }

      // Regenerate hash if data changed
      if (Object.keys(updates).length > 0) {
        const updatedData = {
          title: updates.title || proof.title,
          description: updates.description || proof.description,
          proofType: proof.proofType,
          metadata: updates.metadata || proof.metadata,
          eventData: updates.eventData || proof.eventData,
          recipientAddress: updates.recipientAddress || proof.recipientAddress,
          tags: updates.tags || proof.tags
        };

        updates.hash = this.generateProofHash(updatedData);
        updates.updatedAt = new Date();

        // Reset verification status if data changed
        if (proof.status === 'verified') {
          updates.status = 'draft';
          updates.verifiedAt = undefined;
          updates.verifiedBy = undefined;
        }
      }

      const updatedProof = await Proof.findOneAndUpdate(
        { id: proofId, createdBy: userId },
        updates,
        { new: true }
      ).lean();

      if (updatedProof) {
        // Emit PROOF_UPDATED event using the new event system
        try {
          const proofUpdatedEvent = await eventService.createEvent<ProofUpdatedEvent>(
            'PROOF_UPDATED',
            {
              proofId: updatedProof.id,
              updates: {
                proofType: updates.proofType,
                commitment: updates.hash,
                verificationKey: updates.hash,
                publicInputs: updatedProof.eventData ? Object.values(updatedProof.eventData) : undefined,
                metadata: {
                  title: updates.title,
                  description: updates.description,
                  tags: updates.tags
                }
              },
              updatedBy: userId
            },
            {
              source: 'proof-service',
              correlationId: EventUtils.generateCorrelationId(),
              metadata: {
                operation: 'update',
                timestamp: new Date(),
                changes: Object.keys(updates)
              }
            }
          );
          
          await eventService.publishEvent(proofUpdatedEvent, `proof:${proofId}`);
        } catch (eventError) {
          logger.warn('Failed to publish PROOF_UPDATED event:', eventError);
        }

        // Keep the legacy event emitter for backward compatibility
        this.emit('proofUpdated', updatedProof);
        logger.info(`Proof updated: ${proofId}`);
      }

      return updatedProof;

    } catch (error) {
      logger.error('Error updating proof:', error);
      throw error;
    }
  }

  /**
   * Delete proof
   */
  async deleteProof(proofId: string, userId: string): Promise<boolean> {
    try {
      const result = await Proof.deleteOne({ id: proofId, createdBy: userId });

      if (result.deletedCount > 0) {
        // Emit PROOF_DELETED event using the new event system
        try {
          const proofDeletedEvent = await eventService.createEvent<ProofDeletedEvent>(
            'PROOF_DELETED',
            {
              proofId,
              deletedBy: userId,
              reason: 'User initiated deletion'
            },
            {
              source: 'proof-service',
              correlationId: EventUtils.generateCorrelationId(),
              metadata: {
                operation: 'delete',
                timestamp: new Date()
              }
            }
          );
          
          await eventService.publishEvent(proofDeletedEvent, `proof:${proofId}`);
        } catch (eventError) {
          logger.warn('Failed to publish PROOF_DELETED event:', eventError);
        }

        // Keep the legacy event emitter for backward compatibility
        this.emit('proofDeleted', { proofId, userId });
        logger.info(`Proof deleted: ${proofId}`);
        return true;
      }

      return false;

    } catch (error) {
      logger.error('Error deleting proof:', error);
      throw error;
    }
  }

  /**
   * Batch operations
   */
  async batchOperations(operations: any[], userId: string): Promise<{
    results: any[];
    summary: {
      total: number;
      successful: number;
      failed: number;
    };
  }> {
    const results = [];
    let successful = 0;
    let failed = 0;

    for (const operation of operations) {
      try {
        let result;

        switch (operation.type) {
          case 'create':
            result = await this.createProof({ ...operation.data, createdBy: userId });
            successful++;
            break;

          case 'verify':
            result = await this.verifyProof(operation.proofId, {
              verifiedBy: userId,
              verificationMethod: operation.verificationMethod,
              additionalData: operation.additionalData || {}
            });
            successful++;
            break;

          case 'update':
            result = await this.updateProof(operation.proofId, userId, operation.data);
            if (result) successful++;
            else failed++;
            break;

          case 'delete':
            result = await this.deleteProof(operation.proofId, userId);
            if (result) successful++;
            else failed++;
            break;

          default:
            throw new Error(`Unknown operation type: ${operation.type}`);
        }

        results.push({
          operation: operation.type,
          success: true,
          data: result
        });

      } catch (error) {
        failed++;
        results.push({
          operation: operation.type,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      results,
      summary: {
        total: operations.length,
        successful,
        failed
      }
    };
  }

  /**
   * Get proof statistics
   */
  async getProofStats(userId: string, timeRange: string): Promise<any> {
    try {
      const now = new Date();
      let dateFrom: Date;

      switch (timeRange) {
        case '7d':
          dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
          dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        default:
          dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const stats = await Proof.aggregate([
        {
          $match: {
            createdBy: userId,
            createdAt: { $gte: dateFrom }
          }
        },
        {
          $group: {
            _id: null,
            totalProofs: { $sum: 1 },
            verifiedProofs: {
              $sum: { $cond: [{ $eq: ['$status', 'verified'] }, 1, 0] }
            },
            draftProofs: {
              $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] }
            },
            failedProofs: {
              $sum: { $cond: [{ $eq: ['$status', 'verification_failed'] }, 1, 0] }
            },
            proofTypes: { $addToSet: '$proofType' },
            avgVerificationTime: {
              $avg: {
                $cond: [
                  { $ne: ['$verifiedAt', null] },
                  { $subtract: ['$verifiedAt', '$createdAt'] },
                  null
                ]
              }
            }
          }
        }
      ]);

      const result = stats[0] || {
        totalProofs: 0,
        verifiedProofs: 0,
        draftProofs: 0,
        failedProofs: 0,
        proofTypes: [],
        avgVerificationTime: 0
      };

      return {
        ...result,
        verificationRate: result.totalProofs > 0 ? (result.verifiedProofs / result.totalProofs) * 100 : 0,
        uniqueProofTypes: result.proofTypes.length,
        timeRange
      };

    } catch (error) {
      logger.error('Error getting proof stats:', error);
      throw error;
    }
  }

  /**
   * Search proofs
   */
  async searchProofs(
    filters: {
      query: string;
      proofType?: string;
      status?: string;
      tags?: string[];
      dateFrom?: Date;
      dateTo?: Date;
    },
    pagination: { page: number; limit: number },
    sorting: { sortBy: string; sortOrder: 'asc' | 'desc' }
  ): Promise<any> {
    try {
      const query: any = {
        $or: [
          { title: { $regex: filters.query, $options: 'i' } },
          { description: { $regex: filters.query, $options: 'i' } },
          { tags: { $in: filters.tags || [new RegExp(filters.query, 'i')] } }
        ]
      };

      if (filters.proofType) {
        query.proofType = filters.proofType;
      }

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.tags && filters.tags.length > 0) {
        query.tags = { $in: filters.tags };
      }

      if (filters.dateFrom || filters.dateTo) {
        query.createdAt = {};
        if (filters.dateFrom) {
          query.createdAt.$gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          query.createdAt.$lte = filters.dateTo;
        }
      }

      const sort: any = {};
      sort[sorting.sortBy] = sorting.sortOrder === 'desc' ? -1 : 1;

      const total = await Proof.countDocuments(query);

      const proofs = await Proof.find(query)
        .sort(sort)
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .lean();

      return {
        proofs,
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit)
      };

    } catch (error) {
      logger.error('Error searching proofs:', error);
      throw error;
    }
  }

  /**
   * Export proofs
   */
  async exportProofs(userId: string, filters: any, format: string): Promise<string> {
    try {
      const query: any = { createdBy: userId };

      if (filters.proofType) {
        query.proofType = filters.proofType;
      }

      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.dateFrom || filters.dateTo) {
        query.createdAt = {};
        if (filters.dateFrom) {
          query.createdAt.$gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          query.createdAt.$lte = filters.dateTo;
        }
      }

      const proofs = await Proof.find(query).lean();

      if (format === 'csv') {
        return this.convertToCSV(proofs);
      } else {
        return JSON.stringify(proofs, null, 2);
      }

    } catch (error) {
      logger.error('Error exporting proofs:', error);
      throw error;
    }
  }

  /**
   * Get proof history
   */
  async getProofHistory(proofId: string, userId: string): Promise<any[]> {
    try {
      const proof = await Proof.findOne({ id: proofId, createdBy: userId });

      if (!proof) {
        throw new Error('Proof not found or access denied');
      }

      return proof.verificationHistory || [];

    } catch (error) {
      logger.error('Error getting proof history:', error);
      throw error;
    }
  }

  /**
   * Share proof
   */
  async shareProof(proofId: string, userId: string, shareData: {
    recipientEmail: string;
    permissions: string[];
    message?: string;
  }): Promise<any> {
    try {
      const proof = await Proof.findOne({ id: proofId, createdBy: userId });

      if (!proof) {
        throw new Error('Proof not found or access denied');
      }

      const shareRecord = {
        sharedAt: new Date(),
        sharedBy: userId,
        recipientEmail: shareData.recipientEmail,
        permissions: shareData.permissions,
        message: shareData.message,
        shareId: crypto.randomUUID()
      };

      proof.sharedWith = proof.sharedWith || [];
      proof.sharedWith.push(shareRecord);
      await proof.save();

      // TODO: Send email notification to recipient

      this.emit('proofShared', { proof: proof.toObject(), shareRecord });

      logger.info(`Proof shared: ${proofId} to ${shareData.recipientEmail}`);
      return shareRecord;

    } catch (error) {
      logger.error('Error sharing proof:', error);
      throw error;
    }
  }

  // Helper methods

  private generateProofId(): string {
    return `proof_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateProofHash(data: any): string {
    const dataString = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(dataString).digest('hex');
  }

  private convertToCSV(proofs: any[]): string {
    if (proofs.length === 0) return '';

    const headers = Object.keys(proofs[0]).filter(key => key !== '_id' && key !== '__v');
    const csvRows = [headers.join(',')];

    for (const proof of proofs) {
      const values = headers.map(header => {
        const value = proof[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return JSON.stringify(value);
        return `"${value.toString().replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
  }
}

export const proofService = ProofService.getInstance();
