const { BigNumber } = require("ethers");

const { defaultFixture } = require("../_fixture");
const { expect } = require("chai");

const {
  ousdUnits,
  daiUnits,
  usdcUnits,
  usdtUnits,
  loadFixture,
  setOracleTokenPriceUsd,
  isFork,
  expectApproxSupply,
} = require("../helpers");

describe("Vault Redeem", function () {
  if (isFork) {
    this.timeout(0);
  }

  it("Should allow a redeem", async () => {
    const { ousd, vault, usdc, anna, dai } = await loadFixture(defaultFixture);
    await expect(anna).has.a.balanceOf("1000.00", usdc);
    await expect(anna).has.a.balanceOf("1000.00", dai);
    await usdc.connect(anna).approve(vault.address, usdcUnits("50.0"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("50.0"), 0);
    await expect(anna).has.a.balanceOf("50.00", ousd);
    await vault.connect(anna).redeem(ousdUnits("50.0"), 0);
    await expect(anna).has.a.balanceOf("0.00", ousd);
    // Redeem outputs will be 50/250 * 50 USDC and 200/250 * 50 DAI from fixture
    await expect(anna).has.a.balanceOf("960.00", usdc);
    await expect(anna).has.a.balanceOf("1040.00", dai);
    expect(await ousd.totalSupply()).to.eq(ousdUnits("200.0"));
  });

  it("Should allow a redeem over the rebase threshold", async () => {
    const { ousd, vault, usdc, anna, matt, dai } = await loadFixture(
      defaultFixture
    );

    await expect(anna).has.a.balanceOf("1000.00", usdc);
    await expect(anna).has.a.balanceOf("1000.00", dai);

    await expect(anna).has.a.balanceOf("0.00", ousd);
    await expect(matt).has.a.balanceOf("100.00", ousd);

    // Anna mints OUSD with USDC
    await usdc.connect(anna).approve(vault.address, usdcUnits("1000.00"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("1000.00"), 0);
    await expect(anna).has.a.balanceOf("1000.00", ousd);
    await expect(matt).has.a.balanceOf("100.00", ousd);

    // Anna mints OUSD with DAI
    await dai.connect(anna).approve(vault.address, daiUnits("1000.00"));
    await vault.connect(anna).mint(dai.address, daiUnits("1000.00"), 0);
    await expect(anna).has.a.balanceOf("2000.00", ousd);
    await expect(matt).has.a.balanceOf("100.00", ousd);

    // Rebase should do nothing
    await vault.rebase();
    await expect(anna).has.a.balanceOf("2000.00", ousd);
    await expect(matt).has.a.balanceOf("100.00", ousd);

    // Anna redeems over the rebase threshold
    await vault.connect(anna).redeem(ousdUnits("1500.0"), 0);
    await expect(anna).has.a.approxBalanceOf("500.00", ousd);
    await expect(matt).has.a.approxBalanceOf("100.00", ousd);

    // Redeem outputs will be 1000/2200 * 1500 USDC and 1200/2200 * 1500 DAI from fixture
    await expect(anna).has.an.approxBalanceOf("681.8181", usdc);
    await expect(anna).has.a.approxBalanceOf("818.1818", dai);

    await expectApproxSupply(ousd, ousdUnits("700.0"));
  });

  it("Changing an asset price affects a redeem", async () => {
    const { ousd, vault, dai, matt } = await loadFixture(defaultFixture);
    await expectApproxSupply(ousd, ousdUnits("200"));
    await expect(matt).has.a.balanceOf("100.00", ousd);
    await expect(matt).has.a.balanceOf("900.00", dai);

    await setOracleTokenPriceUsd("DAI", "1.25");
    await vault.rebase();

    await vault.connect(matt).redeem(ousdUnits("2.0"), 0);
    await expectApproxSupply(ousd, ousdUnits("198"));
    // Amount of DAI collected is affected by redeem oracles
    await expect(matt).has.a.approxBalanceOf("901.60", dai);
  });

  it("Should allow redeems of non-standard tokens", async () => {
    const { ousd, vault, anna, governor, nonStandardToken } = await loadFixture(
      defaultFixture
    );

    await vault.connect(governor).supportAsset(nonStandardToken.address);

    await setOracleTokenPriceUsd("NonStandardToken", "1.00");

    await expect(anna).has.a.balanceOf("1000.00", nonStandardToken);

    // Mint 100 OUSD for 100 tokens
    await nonStandardToken
      .connect(anna)
      .approve(vault.address, usdtUnits("100.0"));
    await vault
      .connect(anna)
      .mint(nonStandardToken.address, usdtUnits("100.0"), 0);
    await expect(anna).has.a.balanceOf("100.00", ousd);

    // Redeem 100 tokens for 100 OUSD
    await vault.connect(anna).redeem(ousdUnits("100.0"), 0);
    await expect(anna).has.a.balanceOf("0.00", ousd);
    // 66.66 would have come back as DAI because there is 100 NST and 200 DAI
    await expect(anna).has.an.approxBalanceOf("933.33", nonStandardToken);
  });

  it("Should have a default redeem fee of 0", async () => {
    const { vault } = await loadFixture(defaultFixture);
    await expect(await vault.redeemFeeBps()).to.equal("0");
  });

  it("Should charge a redeem fee if redeem fee set", async () => {
    const { ousd, vault, usdc, anna, governor } = await loadFixture(
      defaultFixture
    );
    // 1000 basis points = 10%
    await vault.connect(governor).setRedeemFeeBps(1000);
    await expect(anna).has.a.balanceOf("1000.00", usdc);
    await usdc.connect(anna).approve(vault.address, usdcUnits("50.0"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("50.0"), 0);
    await expect(anna).has.a.balanceOf("50.00", ousd);
    await vault.connect(anna).redeem(ousdUnits("50.0"), 0);
    await expect(anna).has.a.balanceOf("0.00", ousd);
    // 45 after redeem fee
    // USDC is 50/250 of total assets, so balance should be 950 + 50/250 * 45 = 959
    await expect(anna).has.a.balanceOf("959.00", usdc);
  });

  it("Should revert redeem if balance is insufficient", async () => {
    const { ousd, vault, usdc, anna } = await loadFixture(defaultFixture);

    // Mint some OUSD tokens
    await expect(anna).has.a.balanceOf("1000.00", usdc);
    await usdc.connect(anna).approve(vault.address, usdcUnits("50.0"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("50.0"), 0);
    await expect(anna).has.a.balanceOf("50.00", ousd);

    // Try to withdraw more than balance
    await expect(
      vault.connect(anna).redeem(ousdUnits("100.0"), 0)
    ).to.be.revertedWith("Remove exceeds balance");
  });

  it("Should only allow Governor to set a redeem fee", async () => {
    const { vault, anna } = await loadFixture(defaultFixture);
    await expect(vault.connect(anna).setRedeemFeeBps(100)).to.be.revertedWith(
      "Caller is not the Governor"
    );
  });

  it("Should redeem entire OUSD balance", async () => {
    const { ousd, vault, usdc, dai, anna } = await loadFixture(defaultFixture);

    await expect(anna).has.a.balanceOf("1000.00", usdc);

    // Mint 100 OUSD tokens using USDC
    await usdc.connect(anna).approve(vault.address, usdcUnits("100.0"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("100.0"), 0);
    await expect(anna).has.a.balanceOf("100.00", ousd);

    // Mint 150 OUSD tokens using DAI
    await dai.connect(anna).approve(vault.address, daiUnits("150.0"));
    await vault.connect(anna).mint(dai.address, daiUnits("150.0"), 0);
    await expect(anna).has.a.balanceOf("250.00", ousd);

    // Withdraw all
    await vault.connect(anna).redeemAll(0);

    // 100 USDC and 350 DAI in contract
    // (1000-100) + 100/450 * 250 USDC
    // (1000-150) + 350/450 * 250 DAI
    await expect(anna).has.an.approxBalanceOf("955.55", usdc);
    await expect(anna).has.an.approxBalanceOf("1044.44", dai);
  });

  it("Should redeem entire OUSD balance, with a higher oracle price", async () => {
    const { ousd, vault, usdc, dai, anna, governor } = await loadFixture(
      defaultFixture
    );

    await expect(anna).has.a.balanceOf("1000.00", usdc);

    // Mint 100 OUSD tokens using USDC
    await usdc.connect(anna).approve(vault.address, usdcUnits("100.0"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("100.0"), 0);
    await expect(anna).has.a.balanceOf("100.00", ousd);

    // Mint 150 OUSD tokens using DAI
    await dai.connect(anna).approve(vault.address, daiUnits("150.0"));
    await vault.connect(anna).mint(dai.address, daiUnits("150.0"), 0);
    await expect(anna).has.a.balanceOf("250.00", ousd);

    await setOracleTokenPriceUsd("USDC", "1.30");
    await setOracleTokenPriceUsd("DAI", "1.20");
    await vault.connect(governor).rebase();

    // Anna's balance does not change with the rebase
    await expect(anna).has.an.approxBalanceOf("250.00", ousd);

    // Withdraw all
    await vault.connect(anna).redeemAll(0);

    // OUSD to Withdraw	250
    // Total Vault Coins	450
    // USDC Percentage	100	/	450	=	0.222222222222222
    // DAI Percentage	350	/	450	=	0.777777777777778
    // USDC Value Percentage			0.222222222222222	*	1.3	=	0.288888888888889
    // DAI Value Percentage			0.777777777777778	*	1.2	=	0.933333333333333
    // Output to Dollar Ratio	1.22222222222222
    // USDC Output	250	*	0.222222222222222	/	1.22222222222222	=	45.4545454545454
    // DAI Output	250	*	0.777777777777778	/	1.22222222222222	=	159.090909090909
    // Expected USDC	900	+	45.4545454545454	=	945.454545454545
    // Expected DAI	850	+	159.090909090909	=	1009.09090909091
    await expect(anna).has.an.approxBalanceOf(
      "945.4545",
      usdc,
      "USDC has wrong balance"
    );
    await expect(anna).has.an.approxBalanceOf(
      "1009.09",
      dai,
      "DAI has wrong balance"
    );
  });

  it("Should redeem entire OUSD balance, with a lower oracle price", async () => {
    const { ousd, vault, usdc, dai, anna, governor } = await loadFixture(
      defaultFixture
    );

    await expect(anna).has.a.balanceOf("1000.00", usdc);

    // Mint 100 OUSD tokens using USDC
    await usdc.connect(anna).approve(vault.address, usdcUnits("100.0"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("100.0"), 0);
    await expect(anna).has.a.balanceOf("100.00", ousd);

    // Mint 150 OUSD tokens using DAI
    await dai.connect(anna).approve(vault.address, daiUnits("150.0"));
    await vault.connect(anna).mint(dai.address, daiUnits("150.0"), 0);
    await expect(anna).has.a.balanceOf("250.00", ousd);

    await setOracleTokenPriceUsd("USDC", "0.90");
    await setOracleTokenPriceUsd("DAI", "0.80");
    await vault.connect(governor).rebase();

    // Anna's share of OUSD is unaffected
    await expect(anna).has.an.approxBalanceOf("250.00", ousd);

    // Withdraw all
    await ousd.connect(anna).approve(vault.address, ousdUnits("500"));
    await vault.connect(anna).redeemAll(0);

    // OUSD to Withdraw	250
    // Total Vault Coins	450
    // USDC Percentage	100	/	450	=	0.2222
    // DAI Percentage	350	/	450	=	0.7778
    // USDC Value Percentage			0.2222	*	1	=	0.2222
    // DAI Value Percentage			0.7778	*	1	=	0.7778
    // Output to Dollar Ratio	1.0000
    // USDC Output	250	*	0.2222	/	1.0000	=	55.5556
    // DAI Output	250	*	0.7778	/	1.0000	=	194.4444
    // Expected USDC	900	+	55.5556	=	955.5556
    // Expected DAI	850	+	194.4444	=	1044.4444
    await expect(anna).has.an.approxBalanceOf(
      "955.5556",
      usdc,
      "USDC has wrong balance"
    );
    await expect(anna).has.an.approxBalanceOf(
      "1044.44",
      dai,
      "DAI has wrong balance"
    );
  });

  it("Should have correct balances on consecutive mint and redeem", async () => {
    const { ousd, vault, usdc, dai, anna, matt, josh } = await loadFixture(
      defaultFixture
    );

    const usersWithBalances = [
      [anna, 0],
      [matt, 100],
      [josh, 100],
    ];

    const assetsWithUnits = [
      [dai, daiUnits],
      [usdc, usdcUnits],
    ];

    for (const [user, startBalance] of usersWithBalances) {
      for (const [asset, units] of assetsWithUnits) {
        for (const amount of [5.09, 10.32, 20.99, 100.01]) {
          asset.connect(user).approve(vault.address, units(amount.toString()));
          vault.connect(user).mint(asset.address, units(amount.toString()), 0);
          await expect(user).has.an.approxBalanceOf(
            (startBalance + amount).toString(),
            ousd
          );
          await vault.connect(user).redeem(ousdUnits(amount.toString()), 0);
          await expect(user).has.an.approxBalanceOf(
            startBalance.toString(),
            ousd
          );
        }
      }
    }
  });

  it("Should have correct balances on consecutive mint and redeem with varying oracle prices", async () => {
    const { ousd, vault, dai, usdc, matt, josh } = await loadFixture(
      defaultFixture
    );

    const users = [matt, josh];
    const assetsWithUnits = [
      [dai, daiUnits],
      [usdc, usdcUnits],
    ];
    const prices = [0.98, 1.02, 1.09];
    const amounts = [5.09, 10.32, 20.99, 100.01];

    const getUserOusdBalance = async (user) => {
      const bn = await ousd.balanceOf(await user.getAddress());
      return parseFloat(bn.toString() / 1e12 / 1e6);
    };

    for (const user of users) {
      for (const [asset, units] of assetsWithUnits) {
        for (const price of prices) {
          await setOracleTokenPriceUsd(await asset.symbol(), price.toString());
          // Manually call rebase because not triggered by mint
          await vault.rebase();
          // Rebase could have changed user balance
          // as there could have been yield from different
          // oracle prices on redeems during a previous loop.
          let userBalance = await getUserOusdBalance(user);
          for (const amount of amounts) {
            const ousdToReceive = amount * Math.min(price, 1);
            await expect(user).has.an.approxBalanceOf(
              userBalance.toString(),
              ousd
            );
            await asset
              .connect(user)
              .approve(vault.address, units(amount.toString()));
            await vault
              .connect(user)
              .mint(asset.address, units(amount.toString()), 0);
            await expect(user).has.an.approxBalanceOf(
              (userBalance + ousdToReceive).toString(),
              ousd
            );
            await vault
              .connect(user)
              .redeem(ousdUnits(ousdToReceive.toString()), 0);
            await expect(user).has.an.approxBalanceOf(
              userBalance.toString(),
              ousd
            );
          }
        }
      }
    }
  });

  it("Should correctly handle redeem without a rebase and then redeemAll", async function () {
    const { ousd, vault, usdc, anna } = await loadFixture(defaultFixture);
    await expect(anna).has.a.balanceOf("0.00", ousd);
    await usdc.connect(anna).mint(usdcUnits("3000.0"));
    await usdc.connect(anna).approve(vault.address, usdcUnits("3000.0"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("3000.0"), 0);
    await expect(anna).has.a.balanceOf("3000.00", ousd);

    //peturb the oracle a slight bit.
    await setOracleTokenPriceUsd("USDC", "1.000001");
    //redeem without rebasing (not over threshold)
    await vault.connect(anna).redeem(ousdUnits("200.00"), 0);
    //redeem with rebasing (over threshold)
    await vault.connect(anna).redeemAll(0);

    await expect(anna).has.a.balanceOf("0.00", ousd);
  });

  it("Should have redeemAll result in zero balance", async () => {
    const { ousd, vault, usdc, dai, anna, governor, josh, matt } =
      await loadFixture(defaultFixture);

    await expect(anna).has.a.balanceOf("1000", usdc);
    await expect(anna).has.a.balanceOf("1000", dai);

    // Mint 1000 OUSD tokens using USDC
    await usdc.connect(anna).approve(vault.address, usdcUnits("1000"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("1000"), 0);
    await expect(anna).has.balanceOf("1000", ousd);

    await vault.connect(governor).setRedeemFeeBps("500");
    await setOracleTokenPriceUsd("USDC", "1.005");
    await setOracleTokenPriceUsd("DAI", "1");
    await vault.connect(governor).rebase();

    await vault.connect(anna).redeemAll(0);

    dai.connect(josh).approve(vault.address, daiUnits("50"));
    vault.connect(josh).mint(dai.address, daiUnits("50"), 0);
    dai.connect(matt).approve(vault.address, daiUnits("100"));
    vault.connect(matt).mint(dai.address, daiUnits("100"), 0);

    let newBalance = await usdc.balanceOf(await anna.getAddress());
    let newDaiBalance = await dai.balanceOf(await anna.getAddress());
    await usdc.connect(anna).approve(vault.address, newBalance);
    await vault.connect(anna).mint(usdc.address, newBalance, 0);
    await dai.connect(anna).approve(vault.address, newDaiBalance);
    await vault.connect(anna).mint(dai.address, newDaiBalance, 0);
    await vault.connect(anna).redeemAll(0);
    await expect(anna).has.a.balanceOf("0.00", ousd);
  });

  it("Should respect minimum unit amount argument in redeem", async () => {
    const { ousd, vault, usdc, anna, dai } = await loadFixture(defaultFixture);
    await expect(anna).has.a.balanceOf("1000.00", usdc);
    await expect(anna).has.a.balanceOf("1000.00", dai);
    await usdc.connect(anna).approve(vault.address, usdcUnits("100.0"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("50.0"), 0);
    await expect(anna).has.a.balanceOf("50.00", ousd);
    await vault.connect(anna).redeem(ousdUnits("50.0"), ousdUnits("50"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("50.0"), 0);
    await expect(
      vault.connect(anna).redeem(ousdUnits("50.0"), ousdUnits("51"))
    ).to.be.revertedWith("Redeem amount lower than minimum");
  });

  it("Should respect minimum unit amount argument in redeemAll", async () => {
    const { ousd, vault, usdc, anna, dai } = await loadFixture(defaultFixture);
    await expect(anna).has.a.balanceOf("1000.00", usdc);
    await expect(anna).has.a.balanceOf("1000.00", dai);
    await usdc.connect(anna).approve(vault.address, usdcUnits("100.0"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("50.0"), 0);
    await expect(anna).has.a.balanceOf("50.00", ousd);
    await vault.connect(anna).redeemAll(ousdUnits("50"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("50.0"), 0);
    await expect(
      vault.connect(anna).redeemAll(ousdUnits("51"))
    ).to.be.revertedWith("Redeem amount lower than minimum");
  });

  it("Should calculate redeem outputs", async () => {
    const { vault, anna, usdc, ousd } = await loadFixture(defaultFixture);

    // OUSD total supply is 200 backed by 200 DAI
    await expect(
      await vault.calculateRedeemOutputs(ousdUnits("50"))
    ).to.deep.equal([
      daiUnits("50"), // DAI
      BigNumber.from(0), // USDT
      BigNumber.from(0), // USDC
      BigNumber.from(0), // TUSD
    ]);

    // Mint an additional 600 USDC, so OUSD is backed by 600 USDC and 200 DAI
    // meaning 1/4 of any redeem should come from DAI and 2/3 from USDC
    await usdc.connect(anna).approve(vault.address, usdcUnits("600"));
    await vault.connect(anna).mint(usdc.address, usdcUnits("600"), 0);
    await expect(anna).has.a.balanceOf("600", ousd);
    await expect(
      await vault.calculateRedeemOutputs(ousdUnits("100"))
    ).to.deep.equal([
      daiUnits("25"), // DAI
      BigNumber.from(0), // USDT
      usdcUnits("75"), // USDC
      BigNumber.from(0), // TUSD
    ]);
  });
});
