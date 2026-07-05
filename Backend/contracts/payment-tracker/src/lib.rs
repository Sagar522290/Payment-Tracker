#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec};

mod test;

#[contracttype]
#[derive(Clone)]
pub struct Payment {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub memo: String,
    pub status: String,
}

#[contracttype]
pub enum DataKey {
    Payments(Address),
}

#[contract]
pub struct PaymentTracker;

#[contractimpl]
impl PaymentTracker {
    pub fn create_payment(env: Env, from: Address, to: Address, amount: i128, memo: String) -> Payment {
        from.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let payment = Payment {
            from: from.clone(),
            to,
            amount,
            memo,
            status: String::from_str(&env, "created"),
        };

        let key = DataKey::Payments(from.clone());
        let mut payments: Vec<Payment> = env.storage().persistent().get(&key).unwrap_or(Vec::new(&env));
        payments.push_back(payment.clone());
        env.storage().persistent().set(&key, &payments);
        env.events().publish((symbol_short!("payment"), from), payment.clone());

        payment
    }

    pub fn list_payments(env: Env, owner: Address) -> Vec<Payment> {
        env.storage()
            .persistent()
            .get(&DataKey::Payments(owner))
            .unwrap_or(Vec::new(&env))
    }
}
