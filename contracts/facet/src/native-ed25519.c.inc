extern uint64_t ed25519_verify(uint64_t signature_len, uint64_t signature_ptr,
  uint64_t message_len, uint64_t message_ptr, uint64_t public_key_len, uint64_t public_key_ptr);

static JSValue near_ed25519_verify(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
  if (argc != 3) return JS_ThrowTypeError(ctx, "Expected signature, message, public key");
  size_t signature_len, message_len, public_key_len;
  uint8_t *signature = JS_Uint8Array_to_C(ctx, argv[0], &signature_len);
  uint8_t *message = JS_Uint8Array_to_C(ctx, argv[1], &message_len);
  uint8_t *public_key = JS_Uint8Array_to_C(ctx, argv[2], &public_key_len);
  if (!signature || !message || !public_key || signature_len != 64 || public_key_len != 32)
    return JS_ThrowTypeError(ctx, "Invalid Ed25519 input");
  return JS_NewBool(ctx, ed25519_verify(signature_len, (uint64_t)signature,
    message_len, (uint64_t)message, public_key_len, (uint64_t)public_key) == 1);
}
