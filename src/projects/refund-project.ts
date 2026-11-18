
import { DeliveryStatus, OfferStatus, ProjectStatus, TransactionType, type Prisma } from '../generated/prisma/client.js';

/**
 * Gives the held money back to the client and cancels the project.
 * Must run inside a transaction, with the project row already locked.
 * Returns the refunded amount.
 */
export async function refundHeldAmount(
  tx: Prisma.TransactionClient,
  params: { projectId: number; ownerId: number; note: string },
) {
  const { projectId, ownerId, note } = params;

  const offer = await tx.offer.findFirst({
    where: { projectId, status: OfferStatus.ACCEPTED },
    select: { price: true },
  });
  const hold = await tx.transaction.findFirst({
    where: { projectId, type: TransactionType.HOLD },
    select: { amount: true },
  });

  // safety net: we refund exactly what was held
  if (!offer || !hold || !hold.amount.neg().eq(offer.price)) {
    throw new Error(
      `Held amount does not match the accepted offer (project ${projectId})`,
    );
  }

  const wallet = await tx.wallet.update({
    where: { userId: ownerId },
    data: { balance: { increment: offer.price } },
    select: { id: true },
  });
  await tx.transaction.create({
    data: {
      walletId: wallet.id,
      projectId,
      type: TransactionType.REFUND,
      amount: offer.price,
    },
  });

  await tx.delivery.updateMany({
    where: { projectId, status: DeliveryStatus.PENDING },
    data: { status: DeliveryStatus.REJECTED, clientNote: note },
  });
  await tx.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.CANCELLED },
  });

  return offer.price;
}