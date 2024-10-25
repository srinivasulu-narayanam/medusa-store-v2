import Razorpay from "razorpay";
import { EOL } from "os";
import { AbstractPaymentProvider } from "@medusajs/framework/utils";

import {
  Logger,
  PaymentProviderError,
  PaymentProviderSessionResponse,
  PaymentSessionStatus,
  CreatePaymentProviderSession,
  UpdatePaymentProviderSession,
  PaymentAddressDTO,
  PaymentCustomerDTO,
  ProviderWebhookPayload,
  WebhookActionResult,
} from "@medusajs/framework/types";
import { ErrorCodes, PaymentIntentOptions, RazorpayOptions } from "./types";
import { isPaymentProviderError, MedusaError } from "@medusajs/utils";
import { Orders } from "razorpay/dist/types/orders";
import crypto from "crypto";
import { Refunds } from "razorpay/dist/types/refunds";
import { Customers } from "razorpay/dist/types/customers";
import { Payments } from "razorpay/dist/types/payments";

/**
 * The paymentIntent object corresponds to a razorpay order.
 *
 */

type InjectedDependencies = {
  logger: Logger;
};

class RazorpayProviderService extends AbstractPaymentProvider<RazorpayOptions> {
  static identifier = "razorpay";

  protected readonly options_: RazorpayOptions;
  protected razorpay_: Razorpay;
  protected logger: Logger;

  constructor({ logger }: InjectedDependencies, options: RazorpayOptions) {
    // @ts-ignore
    super(...arguments);

    this.logger = logger;
    this.options_ = options;

    this.init();
  }

  protected init(): void {
    this.razorpay_ =
      this.razorpay_ ||
      new Razorpay({
        key_id: this.options_.key_id,
        key_secret: this.options_.key_secret,
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Account": this.options_.razorpay_account ?? undefined,
        },
      });
  }

  get paymentIntentOptions(): PaymentIntentOptions {
    return {
      // capture_method: "automatic", // Example value, can be dynamic
      // setup_future_usage: "on_session", // Example value
      // payment_method_types: ["card", "upi", "netbanking"], // Example values, based on your needs
    };
  }

  getPaymentIntentOptions(): PaymentIntentOptions {
    const options: PaymentIntentOptions = {};

    if (this?.paymentIntentOptions?.capture_method) {
      options.capture_method = this.paymentIntentOptions.capture_method;
    }

    if (this?.paymentIntentOptions?.setup_future_usage) {
      options.setup_future_usage = this.paymentIntentOptions.setup_future_usage;
    }

    if (this?.paymentIntentOptions?.payment_method_types) {
      options.payment_method_types =
        this.paymentIntentOptions.payment_method_types;
    }

    return options;
  }

  _validateSignature(
    razorpay_payment_id: string,
    razorpay_order_id: string,
    razorpay_signature: string
  ): boolean {
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", this.options_.key_secret as string)
      .update(body.toString())
      .digest("hex");
    return expectedSignature === razorpay_signature;
  }

  async getRazorpayPaymentStatus(
    paymentIntent: Orders.RazorpayOrder
  ): Promise<PaymentSessionStatus> {
    if (!paymentIntent) {
      return "error";
    }
    return "authorized";
    /*
    if (paymentIntent.amount_due != 0) {
      return PaymentSessionStatus.REQUIRES_MORE;
    }

    if (paymentIntent.amount_paid == paymentIntent.amount) {
      return PaymentSessionStatus.AUTHORIZED;
    }
    return PaymentSessionStatus.PENDING;*/

    /**
     * ToFix part payments
     */
  }

  async updateRazorpayMetadatainCustomer(
    customer: PaymentCustomerDTO,
    parameterName: string,
    parameterValue: string
  ): Promise<PaymentCustomerDTO> {
    const metadata = customer.metadata;
    let razorpay = metadata?.razorpay as Record<string, string>;
    if (razorpay) {
      razorpay[parameterName] = parameterValue;
    } else {
      razorpay = {};
      razorpay[parameterName] = parameterValue;
    }
    let result: PaymentCustomerDTO;
    // if (metadata) {
    //   result = await this.customerService.update(customer.id, {
    //     metadata: {
    //       ...metadata,
    //       razorpay,
    //     },
    //   });
    // } else {
    //   result = await this.customerService.update(customer.id, {
    //     metadata: {
    //       razorpay,
    //     },
    //   });
    // }
    return result;
  }
  // @Todo refactor this function to 3 simple functions to make it more readable
  // 1. check existing customer
  // 2. create customer
  // 3. update customer

  async editExistingRpCustomer(
    customer: PaymentCustomerDTO,
    billing_address: PaymentAddressDTO,
    email: string,
    intentRequest
  ): Promise<Customers.RazorpayCustomer | undefined> {
    let razorpayCustomer: Customers.RazorpayCustomer | undefined;

    const razorpay_id =
      intentRequest.notes?.razorpay_id ||
      (customer.metadata?.razorpay_id as string) ||
      (customer.metadata as any)?.razorpay?.rp_customer_id;
    try {
      razorpayCustomer = await this.razorpay_.customers.fetch(razorpay_id);
    } catch (e) {
      this.logger.warn(
        "unable to fetch customer in the razorpay payment processor"
      );
    }
    // edit the customer once fetched
    if (razorpayCustomer) {
      const editEmail = email ?? razorpayCustomer.email;
      const editName = `${customer.first_name ?? ""} ${
        customer.last_name ?? ""
      }`.trim();
      const editPhone =
        billing_address.phone ?? (customer?.phone || billing_address?.phone);
      try {
        const updateRazorpayCustomer = await this.razorpay_.customers.edit(
          razorpayCustomer.id,
          {
            email: editEmail ?? razorpayCustomer.email,
            contact: editPhone ?? razorpayCustomer.contact!,
            name: editName != "" ? editName : razorpayCustomer.name,
          }
        );
        razorpayCustomer = updateRazorpayCustomer;
      } catch (e) {
        this.logger.warn(
          "unable to edit customer in the razorpay payment processor"
        );
      }
    }

    if (!razorpayCustomer) {
      try {
        razorpayCustomer = await this.createRazorpayCustomer(
          customer,
          billing_address,
          email,
          intentRequest
        );
      } catch (e) {
        this.logger.error(
          "something is very wrong please check customer in the dashboard."
        );
      }
    }
    return razorpayCustomer; // returning un modified razorpay customer
  }

  async createRazorpayCustomer(
    customer: PaymentCustomerDTO,
    billing_address: PaymentAddressDTO,
    email: string,
    intentRequest
  ): Promise<Customers.RazorpayCustomer | undefined> {
    let razorpayCustomer: Customers.RazorpayCustomer;
    const phone = billing_address?.phone ?? customer.phone;
    const gstin =
      (billing_address as any)?.gstin ??
      (customer?.metadata?.gstin as string) ??
      undefined;
    if (!phone) {
      throw new Error("phone number to create razorpay customer");
    }
    if (!email) {
      throw new Error("email to create razorpay customer");
    }
    const firstName = customer.first_name ?? "";
    const lastName = customer.last_name ?? "";
    try {
      const customerParams: Customers.RazorpayCustomerCreateRequestBody = {
        email,
        contact: phone,
        gstin: gstin,
        fail_existing: 0,
        name: `${firstName} ${lastName} `,
        notes: {
          updated_at: new Date().toISOString(),
        },
      };
      razorpayCustomer = await this.razorpay_.customers.create(customerParams);

      intentRequest.notes!.razorpay_id = razorpayCustomer?.id;
      if (customer && customer.id) {
        await this.updateRazorpayMetadatainCustomer(
          customer,
          "rp_customer_id",
          razorpayCustomer.id
        );
      }
      return razorpayCustomer;
    } catch (e) {
      this.logger.error(
        "unable to create customer in the razorpay payment processor"
      );
      return;
    }
  }

  async pollAndRetrieveCustomer(
    customer: PaymentCustomerDTO
  ): Promise<Customers.RazorpayCustomer> {
    let customerList: Customers.RazorpayCustomer[] = [];
    let razorpayCustomer: Customers.RazorpayCustomer;
    const count = 10;
    let skip = 0;
    do {
      customerList = (
        await this.razorpay_.customers.all({
          count,
          skip,
        })
      )?.items;
      razorpayCustomer =
        customerList?.find(
          (c) => c.contact == customer?.phone || c.email == customer.email
        ) ?? customerList?.[0];
      if (razorpayCustomer) {
        await this.updateRazorpayMetadatainCustomer(
          customer,
          "rp_customer_id",
          razorpayCustomer.id
        );
        break;
      }
      if (!customerList || !razorpayCustomer) {
        throw new Error("no customers and cant create customers in razorpay");
      }
      skip += count;
    } while (customerList?.length == 0);

    return razorpayCustomer;
  }

  async fetchOrPollForCustomer(
    customer: PaymentCustomerDTO
  ): Promise<Customers.RazorpayCustomer | undefined> {
    let razorpayCustomer: Customers.RazorpayCustomer | undefined;
    try {
      const rp_customer_id = (
        customer.metadata?.razorpay as Record<string, string>
      )?.rp_customer_id;
      if (rp_customer_id) {
        razorpayCustomer = await this.razorpay_.customers.fetch(rp_customer_id);
      } else {
        razorpayCustomer = await this.pollAndRetrieveCustomer(customer);
      }
      return razorpayCustomer;
    } catch (e) {
      this.logger.error(
        "unable to poll customer in the razorpay payment processor"
      );
      return;
    }
  }

  async createOrUpdateCustomer(
    intentRequest,
    customer: PaymentCustomerDTO,
    email: string,
    billing_address: PaymentAddressDTO
  ): Promise<Customers.RazorpayCustomer | undefined> {
    let razorpayCustomer: Customers.RazorpayCustomer | undefined;
    try {
      const razorpay_id =
        customer.metadata?.razorpay_id ||
        (customer.metadata as any)?.razorpay?.rp_customer_id ||
        customer?.metadata?.razorpay_id ||
        (customer?.metadata as any)?.razorpay?.rp_customer_id ||
        intentRequest.notes.razorpay_id;
      try {
        if (razorpay_id) {
          this.logger.info("the updating  existing customer  in razorpay");

          razorpayCustomer = await this.editExistingRpCustomer(
            customer,
            billing_address,
            email,
            intentRequest
          );
        }
      } catch (e) {
        this.logger.info("the customer doesn't exist in razopay");
      }
      try {
        if (!razorpayCustomer) {
          this.logger.info("the creating  customer  in razopay");

          razorpayCustomer = await this.createRazorpayCustomer(
            customer,
            billing_address,
            email,
            intentRequest
          );
        }
      } catch (e) {
        // if customer already exists in razorpay but isn't associated with a customer in medsusa
        try {
          this.logger.info("relinking  customer  in razorpay by polling");

          razorpayCustomer = await this.fetchOrPollForCustomer(customer);
        } catch (e) {
          this.logger.error(
            "unable to poll customer customer in the razorpay payment processor"
          );
        }
      }
      return razorpayCustomer;
    } catch (e) {
      this.logger.error("unable to retrieve customer from cart");
    }
    return razorpayCustomer;
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    const order_id = (paymentSessionData as unknown as Orders.RazorpayOrder).id;
    const paymentsResponse = await this.razorpay_.orders.fetchPayments(
      order_id
    );
    const possibleCatpures = paymentsResponse.items?.filter(
      (item) => item.status == "authorized"
    );
    const result = possibleCatpures?.map(async (payment) => {
      const { id, amount, currency } = payment;

      const paymentIntent = await this.razorpay_.payments.capture(
        id,
        amount as string,
        currency as string
      );
      return paymentIntent;
    });
    if (result) {
      const payments = await Promise.all(result);
      const res = payments.reduce(
        (acc, curr) => ((acc[curr.id] = curr), acc),
        {}
      );
      (paymentSessionData as unknown as Orders.RazorpayOrder).payments = res;
    }
    return paymentSessionData;
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    context?: Record<string, unknown>
  ): Promise<
    | PaymentProviderError
    | {
        status: PaymentSessionStatus;
        data: PaymentProviderSessionResponse["data"];
      }
  > {
    console.log("payment auth",{context})
    const status = await this.getPaymentStatus(paymentSessionData);
    return { data: paymentSessionData, status };
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    const error: PaymentProviderError = {
      error: "Unable to cancel as razorpay doesn't support cancellation",
      code: ErrorCodes.UNSUPPORTED_OPERATION,
    };
    return error;
  }

  async initiatePayment(
    context: CreatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const intentRequestData = this.getPaymentIntentOptions();
    const { currency_code, amount } = context;
    const { email, customer, session_id, extra, billing_address } =
      context.context;
    const sessionNotes = extra?.notes as Record<string, string>;
    const intentRequest: Orders.RazorpayOrderCreateRequestBody & {
      payment_capture?: Orders.RazorpayCapturePayment;
    } = {
      amount: Math.round(Number(amount)),
      currency: currency_code.toUpperCase(),
      notes: { ...sessionNotes, session_id },
      payment: {
        capture: this.options_.auto_capture ? "automatic" : "manual",
        capture_options: {
          refund_speed: this.options_.refund_speed ?? "normal",
          automatic_expiry_period: Math.max(
            this.options_.automatic_expiry_period ?? 20,
            12
          ),
          manual_expiry_period: Math.max(
            this.options_.manual_expiry_period ?? 10,
            7200
          ),
        },
      },
      ...intentRequestData,
    };
    console.log({intentRequest})
    let data: Orders.RazorpayOrder | undefined;
    try {
      const razorpayCustomer = await this.createOrUpdateCustomer(
        intentRequest,
        customer!,
        email,
        billing_address
      );
      console.log({razorpayCustomer})
      try {
        if (razorpayCustomer) {
          this.logger.debug(`the intent: ${JSON.stringify(intentRequest)}`);
          data = await this.razorpay_.orders.create(intentRequest);
        } else {
          this.logger.error("unable to find razorpay customer");
        }
      } catch (e) {
        return this.buildError(
          "An error occurred in InitiatePayment during the creation of the razorpay payment intent: " +
            JSON.stringify(e),
          e
        );
      }
    } catch (e) {
      return this.buildError(
        "An error occurred in creating customer request:" + e.message,
        e
      );
    }
    console.log({customer})

    return {
      data: customer?.metadata?.razorpay_id
        ? undefined
        : {
            customer_metadata: {
              razorpay_id: intentRequest.notes!.razorpay_id,
            },
          },
    };
  }

  async deletePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    return await this.cancelPayment(paymentSessionData);
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    console.log({paymentSessionData})
    const id = paymentSessionData.id as string;
    // const orderId = paymentSessionData.order_id as string;
    // console.log({orderId})
    let paymentIntent: Orders.RazorpayOrder;
    try {
      paymentIntent = await this.razorpay_.orders.fetch(id);
    } catch (e) {
      this.logger.warn("received payment data from session not order data");
      // paymentIntent = await this.razorpay_.orders.fetch(orderId);
    }

    switch (paymentIntent.status) {
      // created' | 'authorized' | 'captured' | 'refunded' | 'failed'
      case "created":
        return "requires_more";

      case "paid":
        return "authorized";

      case "attempted":
        return await this.getRazorpayPaymentStatus(paymentIntent);

      default:
        return "pending";
    }
  }

  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    const id = (paymentSessionData as unknown as Orders.RazorpayOrder)
      .id as string;
    const paymentIntent = await this.razorpay_.orders.fetch(id);
    const paymentList = paymentIntent.payments ?? {};

    const paymentIds = Object.keys(paymentList);
    const payments = await Promise.all(
      paymentIds.map(
        async (paymentId) => await this.razorpay_.payments.fetch(paymentId)
      )
    );
    const payment_id = payments.find((p) => {
      parseInt(p.amount.toString()) >= refundAmount;
    })?.id;

    if (payment_id) {
      const refundRequest: Refunds.RazorpayRefundCreateRequestBody = {
        amount: refundAmount,
      };
      try {
        const refundSession = await this.razorpay_.payments.refund(
          payment_id,
          refundRequest
        );
        const refundsIssued =
          paymentSessionData.refundSessions as Refunds.RazorpayRefund[];
        if (refundsIssued?.length > 0) {
          refundsIssued.push(refundSession);
        } else {
          paymentSessionData.refundSessions = [refundSession];
        }
      } catch (e) {
        return this.buildError("An error occurred in refundPayment", e);
      }
    }
    return paymentSessionData;
  }

  async retrievePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    let intent;
    try {
      const id = (paymentSessionData as unknown as Orders.RazorpayOrder)
        .id as string;
      intent = await this.razorpay_.orders.fetch(id);
    } catch (e) {
      const id = (paymentSessionData as unknown as Payments.RazorpayPayment)
        .order_id as string;
      try {
        intent = await this.razorpay_.orders.fetch(id);
      } catch (e) {
        this.buildError("An error occurred in retrievePayment", e);
      }
    }
    return intent as unknown as PaymentProviderSessionResponse["data"];
  }

  async updatePayment(
    context: UpdatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const { amount, currency_code, data } = context;
    const { customer, session_id, billing_address } = context.context;
    try {
      if (!billing_address) {
        return;
      }
    } catch {
      return this.buildError(
        "An error occurred in updatePayment during the retrieve of the cart",
        new Error(
          "An error occurred in updatePayment during the retrieve of the cart"
        )
      );
    }
    let customerPhone = "";
    let razorpayId;
    if (customer) {
      try {
        razorpayId =
          customer?.metadata?.razorpay_id ||
          (customer?.metadata as any)?.razopay?.rp_customer_id;
        customerPhone = customer?.phone ?? billing_address?.phone;
        if (!billing_address) {
          this.logger.warn("no customer billing found");
        }
      } catch {
        return this.buildError(
          "An error occurred in updatePayment during the retrieve of the customer",
          new Error(
            "An error occurred in updatePayment during the retrieve of the customer"
          )
        );
      }
    }
    const isCartNonEmptyPhone =
      billing_address?.phone && billing_address?.phone != "";

    if (razorpayId !== (data?.customer as any)?.id) {
      const phone = isCartNonEmptyPhone
        ? billing_address?.phone
        : customerPhone;

      if (!phone) {
        this.logger.warn("phone number wasn't specified");
        return;
      }
      const result = await this.initiatePayment(context);
      if (isPaymentProviderError(result)) {
        return this.buildError(
          "An error occurred in updatePayment during the initiate of the new payment for the new customer",
          result
        );
      }

      return result;
    } else {
      if (!amount && !currency_code) {
        return this.buildError(
          "amount or currency_code not supported",
          new Error("the phone number wasn't specified")
        );
      }

      try {
        const id = data.id as string;
        let sessionOrderData: Partial<Orders.RazorpayOrder> = {
          currency: "INR",
        };
        if (id) {
          sessionOrderData = (await this.razorpay_.orders.fetch(
            id
          )) as Partial<Orders.RazorpayOrder>;
          delete sessionOrderData.id;
          delete sessionOrderData.created_at;
        }
        context.currency_code =
          currency_code?.toUpperCase() ?? sessionOrderData?.currency ?? "INR";
        const newPaymentSessionOrder = (await this.initiatePayment(
          context
        )) as PaymentProviderSessionResponse;

        return { data: { ...newPaymentSessionOrder.data } };
      } catch (e) {
        return this.buildError("An error occurred in updatePayment", e);
      }
    }
  }

  async updatePaymentData(
    sessionId: string,
    data: Record<string, unknown>
  ): Promise<PaymentProviderSessionResponse["data"] | PaymentProviderError> {
    try {
      // Prevent from updating the amount from here as it should go through
      // the updatePayment method to perform the correct logic
      if (data.amount || data.currency) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Cannot update amount, use updatePayment instead"
        );
      }
      try {
        const paymentSession = await this.razorpay_.payments.fetch(
          (data.data as Record<string, any>).id as string
        );
        if (data.notes || (data.data as any)?.notes) {
          const notes = data.notes || (data.data as any)?.notes;
          const result = (await this.razorpay_.orders.edit(sessionId, {
            notes: { ...paymentSession.notes, ...notes },
          })) as unknown as PaymentProviderSessionResponse["data"];
          return result;
        } else {
          this.logger.warn("only notes can be updated in razorpay order");
          return paymentSession as unknown as PaymentProviderSessionResponse["data"];
        }
      } catch (e) {
        return (data as Record<string, any>).data ?? data;
      }
    } catch (e) {
      return this.buildError("An error occurred in updatePaymentData", e);
    }
  }

  getWebhookActionAndData(
    data: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    throw new Error("Method not implemented.");
  }
  /*
  /**
   * Constructs Razorpay Webhook event
   * @param {object} data - the data of the webhook request: req.body
   * @param {object} signature - the Razorpay signature on the event, that
   *    ensures integrity of the webhook event
   * @return {object} Razorpay Webhook event
   */

  constructWebhookEvent(data, signature): boolean {
    return Razorpay.validateWebhookSignature(
      data,
      signature,
      this.options_.webhook_secret
    );
  }

  protected buildError(
    message: string,
    e: PaymentProviderError | Error
  ): PaymentProviderError {
    return {
      error: message,
      code: "code" in e ? e.code : "",
      detail: isPaymentProviderError(e)
        ? `${e.error}${EOL}${e.detail ?? ""}`
        : "detail" in e
        ? e.detail
        : e.message ?? "",
    };
  }
}

export default RazorpayProviderService;
