/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hono } from 'hono';
import { dbManager } from '../db/mongo.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { addToCartSchema, updateCartItemSchema } from '../validators/schemas.ts';
import type { Cart, CartItem, User } from '../types/index.ts';
import type { AppEnv } from '../types/hono.ts';

const cartApp = new Hono<AppEnv>();

/**
 * Get current user's shopping cart
 */
cartApp.get('/', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const mem = dbManager.inMemory;
  let cart = mem.carts.get(user.id);

  if (!cart) {
    cart = { userId: user.id, items: [], updatedAt: new Date().toISOString() };
    mem.carts.set(user.id, cart);
  }

  const subtotal = cart.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
  const uniqueVendorsCount = new Set(cart.items.map((i) => i.sellerId)).size;

  return c.json({
    success: true,
    cart,
    summary: {
      totalItems: cart.items.reduce((sum, it) => sum + it.quantity, 0),
      uniqueVendorsCount,
      subtotalKES: subtotal,
      requiresMultiVendorSplit: uniqueVendorsCount > 1,
    },
  });
});

/**
 * Add product to cart
 */
cartApp.post('/items', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const parsed = addToCartSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const mem = dbManager.inMemory;
  const prod = mem.products.get(parsed.data.productId);
  if (!prod) return c.json({ success: false, error: 'Product not found' }, 404);

  if (prod.stockQuantity < parsed.data.quantity) {
    return c.json(
      {
        success: false,
        error: 'InsufficientStock',
        message: `Only ${prod.stockQuantity} ${prod.unit} available in stock.`,
      },
      400
    );
  }

  let cart = mem.carts.get(user.id);
  if (!cart) {
    cart = { userId: user.id, items: [], updatedAt: new Date().toISOString() };
    mem.carts.set(user.id, cart);
  }

  const existingIndex = cart.items.findIndex((i) => i.productId === prod.id);
  if (existingIndex > -1) {
    const newQty = cart.items[existingIndex].quantity + parsed.data.quantity;
    if (prod.stockQuantity < newQty) {
      return c.json(
        {
          success: false,
          error: 'InsufficientStock',
          message: `Cannot add more. Total in cart (${newQty}) exceeds stock (${prod.stockQuantity}).`,
        },
        400
      );
    }
    cart.items[existingIndex].quantity = newQty;
  } else {
    const item: CartItem = {
      productId: prod.id,
      quantity: parsed.data.quantity,
      unitPrice: prod.pricePerUnit,
      sellerId: prod.sellerId,
      sellerRole: prod.sellerRole,
      title: prod.title,
      unit: prod.unit,
      location: prod.location,
    };
    cart.items.push(item);
  }

  cart.updatedAt = new Date().toISOString();
  return c.json({ success: true, message: 'Item added to cart', cart });
});

/**
 * Update quantity of item in cart
 */
cartApp.patch('/items/:productId', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const productId = c.req.param('productId')!;
  const body = await c.req.json();
  const parsed = updateCartItemSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'ValidationError', details: parsed.error.issues }, 400);
  }

  const mem = dbManager.inMemory;
  const cart = mem.carts.get(user.id);
  if (!cart) return c.json({ success: false, error: 'Cart empty' }, 404);

  const item = cart.items.find((i) => i.productId === productId);
  if (!item) return c.json({ success: false, error: 'Item not in cart' }, 404);

  if (parsed.data.quantity === 0) {
    cart.items = cart.items.filter((i) => i.productId !== productId);
  } else {
    const prod = mem.products.get(productId);
    if (prod && prod.stockQuantity < parsed.data.quantity) {
      return c.json(
        { success: false, error: `Only ${prod.stockQuantity} ${prod.unit} available in stock.` },
        400
      );
    }
    item.quantity = parsed.data.quantity;
  }

  cart.updatedAt = new Date().toISOString();
  return c.json({ success: true, cart });
});

/**
 * Remove single item from cart
 */
cartApp.delete('/items/:productId', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const productId = c.req.param('productId')!;
  const mem = dbManager.inMemory;
  const cart = mem.carts.get(user.id);

  if (cart) {
    cart.items = cart.items.filter((i) => i.productId !== productId);
    cart.updatedAt = new Date().toISOString();
  }

  return c.json({ success: true, message: 'Item removed', cart });
});

/**
 * Clear cart
 */
cartApp.delete('/', authMiddleware, async (c) => {
  const user = c.get('user') as User;
  const mem = dbManager.inMemory;
  mem.carts.delete(user.id);
  return c.json({ success: true, message: 'Cart cleared' });
});

export default cartApp;
