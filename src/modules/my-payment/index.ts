import RazorpayProviderService from "./razorpay"
import { 
  ModuleProvider, 
  Modules
} from "@medusajs/framework/utils"

export default ModuleProvider(Modules.PAYMENT, {
  services: [RazorpayProviderService],
})