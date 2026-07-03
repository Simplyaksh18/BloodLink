import { Request, Response } from 'express';
import * as messagesService from '../services/messages.service';
import { ApiResponse } from '../utils/ApiResponse';
import { asyncHandler } from '../utils/asyncHandler';

export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const data = await messagesService.getConversations(userId);
  ApiResponse.success(res, data);
});

export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id } = req.params;
  const data = await messagesService.getConversationDetail(id, userId);
  ApiResponse.success(res, data);
});

export const createBankConversation = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { bankId } = req.params;
  const result = await messagesService.createOrGetBankConversation(bankId, userId);
  console.log('[BankMessage] conversation created/reused:', result.created ? 'created' : 'reused', 'conversationId:', result.conversationId);
  ApiResponse.success(res, result);
});

export const createBankRequestConversation = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { requestId } = req.params;
  const result = await messagesService.createOrGetBankRequestConversation(requestId, userId);
  console.log('[BankChatLink] conversation created/reused:', result.created ? 'created' : 'reused', 'conversationId:', result.conversationId, 'requestStatus:', result.requestStatus);
  ApiResponse.success(res, result);
});

export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id: conversationId } = req.params;
  const { body } = req.body;
  console.log('[MessageSend] conversationId:', conversationId, '| senderId:', userId, '| body length:', body?.length ?? 0);
  const data = await messagesService.sendMessage(conversationId, userId, body);
  console.log('[MessagesUI] send success');
  ApiResponse.success(res, data, 'Message sent');
});
